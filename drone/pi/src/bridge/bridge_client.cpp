#include "bridge/bridge_client.hpp"

#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>

#include "core/log.hpp"

namespace drone {

namespace {

constexpr std::size_t kMaxInboundLine = 64 * 1024;  // a mission is well under 1 KB

bool set_non_blocking(int fd) {
  const int flags = fcntl(fd, F_GETFL, 0);
  return flags >= 0 && fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0;
}

// Never let a dead bridge kill the drone with SIGPIPE (macOS has no MSG_NOSIGNAL).
void no_sigpipe(int fd) {
#ifdef SO_NOSIGPIPE
  int one = 1;
  setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one));
#else
  (void)fd;
#endif
}

#ifdef MSG_NOSIGNAL
constexpr int kSendFlags = MSG_NOSIGNAL;
#else
constexpr int kSendFlags = 0;
#endif

std::string seconds_text(double ms) {
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%.1f s", ms / 1000.0);
  return buf;
}

SteadyTime after(SteadyTime t, double ms) {
  return t + std::chrono::duration_cast<SteadyTime::duration>(std::chrono::duration<double, std::milli>(ms));
}

// The start of a line, for log messages.
std::string head(const std::string& line) {
  std::string out = line.substr(0, 80);
  if (!out.empty() && out.back() == '\n') out.pop_back();
  return out;
}

}  // namespace

BridgeClient::BridgeClient(BridgeClientConfig config)
    : config_(std::move(config)), backoff_ms_(config_.backoff_initial_ms) {}

BridgeClient::~BridgeClient() { close(); }

void BridgeClient::send(const nlohmann::json& message) {
  std::string line = message.dump() + "\n";
  const std::string type = message.value("type", "");
  if (!is_important_message(message)) {
    if (!connected()) return;  // current state: the main loop sends a fresh one after the connect
    if (telemetry_.size() >= config_.telemetry_capacity) {
      telemetry_.pop_front();
      ++telemetry_dropped_;
      log::debug("bridge: telemetry queue full, dropped the oldest");
    }
    telemetry_.push_back({next_order_++, std::move(line)});
    return;
  }
  // Device status is current state, and the main loop resends it after each connect,
  // so an old line is never replayed (like the bridge spool keeps only the newest position).
  const bool replayable = type != "device";
  if (!connected() && !replayable) return;
  // While the bridge is gone, the other important lines go straight to the outbox file. Once a
  // line is held in memory (an append failed), later ones stay in memory too: the outbox replays
  // before memory, so writing a newer line to the outbox would send it before the older one.
  if (!connected() && !config_.outbox_path.empty() && important_.empty()) {
    if (append_outbox({line})) return;
    // The disk failed too: keep it in memory, it still goes out on reconnect if we do not restart.
  }
  if (important_.size() >= config_.important_capacity) {
    log::error("bridge: important queue full, dropped the oldest: " + head(important_.front().line));
    important_.pop_front();
    ++important_dropped_;
  }
  important_.push_back({next_order_++, std::move(line), replayable});
}

std::vector<InboundMessage> BridgeClient::poll(SteadyTime now) {
  std::vector<InboundMessage> out;
  if (fd_ < 0) {
    if (now >= next_attempt_) try_connect(now);
  } else if (connecting_) {
    finish_connect(now);
  }
  if (connected()) read_inbound(now, &out);
  if (connected()) write_outbound(now);
  return out;
}

bool BridgeClient::take_reconnected() {
  const bool r = reconnected_;
  reconnected_ = false;
  return r;
}

void BridgeClient::try_connect(SteadyTime now) {
  sockaddr_un addr{};
  if (config_.socket_path.size() >= sizeof(addr.sun_path)) {
    last_connect_error_ = "socket path too long";
    schedule_retry(now);
    return;
  }
  fd_ = ::socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd_ < 0 || !set_non_blocking(fd_)) {
    last_connect_error_ = std::string("socket: ") + std::strerror(errno);
    if (fd_ >= 0) ::close(fd_);
    fd_ = -1;
    schedule_retry(now);
    return;
  }
  no_sigpipe(fd_);
  addr.sun_family = AF_UNIX;
  std::strncpy(addr.sun_path, config_.socket_path.c_str(), sizeof(addr.sun_path) - 1);
  if (::connect(fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0) {
    on_connected();
    return;
  }
  if (errno == EINPROGRESS) {
    connecting_ = true;  // finish_connect() checks it on the next polls
    return;
  }
  last_connect_error_ = std::strerror(errno);  // ENOENT or ECONNREFUSED: the bridge is not up
  ::close(fd_);
  fd_ = -1;
  schedule_retry(now);
}

void BridgeClient::finish_connect(SteadyTime now) {
  pollfd p{fd_, POLLOUT, 0};
  if (::poll(&p, 1, 0) <= 0) return;  // still connecting; zero timeout, so this never waits
  int err = 0;
  socklen_t len = sizeof(err);
  getsockopt(fd_, SOL_SOCKET, SO_ERROR, &err, &len);
  if (err == 0) {
    on_connected();
    return;
  }
  last_connect_error_ = std::strerror(err);
  ::close(fd_);
  fd_ = -1;
  connecting_ = false;
  schedule_retry(now);
}

void BridgeClient::on_connected() {
  connecting_ = false;
  reconnected_ = true;
  backoff_ms_ = config_.backoff_initial_ms;
  last_connect_error_.clear();
  recent_sent_.clear();
  log::info("bridge: connected to " + config_.socket_path);
  // The outbox goes first, so detections from the outage arrive before newer messages.
  start_replay();
}

void BridgeClient::start_replay() {
  if (config_.outbox_path.empty()) return;
  namespace fs = std::filesystem;
  std::error_code ec;
  const std::string replaying = replaying_path();
  if (fs::exists(config_.outbox_path, ec)) {
    const auto size = fs::file_size(config_.outbox_path, ec);
    if (!ec && size == 0) {
      fs::remove(config_.outbox_path, ec);
    } else if (!fs::exists(replaying, ec)) {
      fs::rename(config_.outbox_path, replaying, ec);
      if (ec) log::error("bridge: cannot rename the outbox for replay: " + ec.message());
    } else {
      // A replay cut short (a crash, or the link dropped) is older: it goes first, then the outbox.
      std::ifstream in(config_.outbox_path, std::ios::binary);
      std::ofstream out(replaying, std::ios::app | std::ios::binary);
      out << in.rdbuf();
      out.flush();
      in.close();
      if (out) {
        fs::remove(config_.outbox_path, ec);
      } else {
        log::error("bridge: cannot append the outbox to " + replaying + "; it replays on a later connect");
      }
    }
  }
  replay_offset_ = 0;
  replay_active_ = fs::exists(replaying, ec);
  if (replay_active_) load_replay_batch();
}

void BridgeClient::load_replay_batch() {
  std::ifstream file(replaying_path(), std::ios::binary);
  if (file) file.seekg(static_cast<std::streamoff>(replay_offset_));
  std::size_t loaded = 0;
  std::string line;
  // A cap per batch, so one connect never reads a large file in a single tick.
  while (file && loaded < config_.important_capacity && std::getline(file, line)) {
    replay_offset_ += line.size() + 1;
    if (line.empty()) continue;
    replay_.push_back(line + "\n");
    ++loaded;
  }
  if (loaded > 0) {
    log::info("bridge: replaying " + std::to_string(loaded) + " outbox lines");
    return;
  }
  // Every line was fully written: only now is the file gone.
  file.close();
  std::error_code ec;
  std::filesystem::remove(replaying_path(), ec);
  replay_active_ = false;
  replay_offset_ = 0;
}

void BridgeClient::schedule_retry(SteadyTime now) {
  next_attempt_ = after(now, backoff_ms_);
  log::warn("bridge: cannot connect to " + config_.socket_path + " (" + last_connect_error_ + "), retry in " +
            seconds_text(backoff_ms_));
  backoff_ms_ = std::min(backoff_ms_ * 2, config_.backoff_max_ms);
}

void BridgeClient::disconnect(SteadyTime now, const std::string& why) {
  close_socket(true);
  next_attempt_ = after(now, backoff_ms_);
  log::warn("bridge: lost connection (" + why + "), retry in " + seconds_text(backoff_ms_));
}

std::size_t BridgeClient::keep_unsent(bool unclean) {
  // Keep every important line that may not have reached the bridge, in order: after an unclean
  // drop the last lines written (still in the kernel buffer, maybe never read), then the one being
  // written, then the important queue. The bridge drops a partial line. The rest of an outbox
  // replay needs nothing: the .replaying file still holds it, and the next connect replays it first.
  std::vector<std::string> keep;
  if (unclean) {
    for (auto& line : recent_sent_) keep.push_back(std::move(line));
  }
  recent_sent_.clear();
  if (current_important_ && current_replayable_ && !current_from_file_ && !current_.empty()) keep.push_back(current_);
  for (auto& e : important_) {
    if (e.replayable) keep.push_back(std::move(e.line));
  }
  replay_.clear();
  replay_active_ = false;
  replay_offset_ = 0;
  important_.clear();
  telemetry_.clear();  // current state: the main loop sends fresh telemetry after the next connect
  current_.clear();
  current_sent_ = 0;
  current_important_ = false;
  current_replayable_ = false;
  current_from_file_ = false;
  if (!keep.empty() && (config_.outbox_path.empty() || !append_outbox(keep))) {
    for (auto& line : keep) important_.push_back({next_order_++, std::move(line), true});
  }
  if (!keep.empty()) log::info("bridge: " + std::to_string(keep.size()) + " unsent important lines kept for replay");
  return keep.size();
}

void BridgeClient::read_inbound(SteadyTime now, std::vector<InboundMessage>* out) {
  std::string closed_why;
  char buffer[4096];
  while (true) {
    const ssize_t n = ::recv(fd_, buffer, sizeof(buffer), 0);
    if (n > 0) {
      inbox_.append(buffer, static_cast<std::size_t>(n));
      if (inbox_.size() > kMaxInboundLine && inbox_.find('\n') == std::string::npos) {
        log::error("bridge: inbound line over 64 KB with no newline, discarded");
        inbox_.clear();
      }
      continue;
    }
    if (n == 0) {
      closed_why = "bridge closed the socket";
    } else if (errno == EINTR) {
      continue;
    } else if (errno != EAGAIN && errno != EWOULDBLOCK) {
      closed_why = std::strerror(errno);
    }
    break;
  }

  // Whole lines only; a cap per tick keeps one burst from making a slow tick.
  std::size_t parsed = 0;
  std::size_t newline;
  while (parsed < config_.max_inbound_per_poll && (newline = inbox_.find('\n')) != std::string::npos) {
    const std::string line = inbox_.substr(0, newline);
    inbox_.erase(0, newline + 1);
    if (line.empty()) continue;
    ++parsed;
    InboundMessage msg;
    std::string why;
    switch (parse_inbound(line, &msg, &why)) {
      case ParseStatus::Ok: out->push_back(std::move(msg)); break;
      case ParseStatus::UnknownType: log::info("bridge: ignored " + why); break;
      case ParseStatus::Invalid: log::warn("bridge: ignored bad line (" + why + "): " + head(line)); break;
    }
  }
  if (!closed_why.empty()) disconnect(now, closed_why);
}

bool BridgeClient::next_line() {
  current_sent_ = 0;
  current_from_file_ = false;
  // Called only once the line before is fully written, so an empty batch means the batch is done.
  if (replay_.empty() && replay_active_) load_replay_batch();
  if (!replay_.empty()) {
    current_ = std::move(replay_.front());
    replay_.pop_front();
    current_important_ = true;
    current_replayable_ = true;
    current_from_file_ = true;
    return true;
  }
  const bool has_t = !telemetry_.empty(), has_i = !important_.empty();
  if (!has_t && !has_i) return false;
  // Oldest first across both queues, so a heartbeat queued before a device line goes before it.
  const bool take_important = has_i && (!has_t || important_.front().order < telemetry_.front().order);
  auto& queue = take_important ? important_ : telemetry_;
  current_ = std::move(queue.front().line);
  current_important_ = take_important;
  current_replayable_ = take_important && queue.front().replayable;
  queue.pop_front();
  return true;
}

void BridgeClient::write_outbound(SteadyTime now) {
  while (true) {
    if (current_sent_ >= current_.size()) {
      // Written to the kernel buffer, not yet read by the bridge: remember it for an unclean drop.
      if (!current_.empty() && current_replayable_ && config_.resend_on_drop > 0) {
        if (recent_sent_.size() >= config_.resend_on_drop) recent_sent_.pop_front();
        recent_sent_.push_back(std::move(current_));
      }
      current_.clear();
      if (!next_line()) return;
    }
    const ssize_t n = ::send(fd_, current_.data() + current_sent_, current_.size() - current_sent_, kSendFlags);
    if (n > 0) {
      current_sent_ += static_cast<std::size_t>(n);
      continue;
    }
    if (n < 0 && errno == EINTR) continue;
    if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return;  // the bridge is slow; the rest waits
    disconnect(now, n == 0 ? "send wrote nothing" : std::strerror(errno));
    return;
  }
}

// No fsync: on an SD card it can block for tens of milliseconds, and this runs on the main loop.
// A power cut can lose the last appended lines; a crash of this program does not (the kernel has them).
bool BridgeClient::append_outbox(const std::vector<std::string>& lines) {
  std::error_code ec;
  const auto parent = std::filesystem::path(config_.outbox_path).parent_path();
  if (!parent.empty()) std::filesystem::create_directories(parent, ec);
  std::ofstream file(config_.outbox_path, std::ios::app | std::ios::binary);
  for (const auto& line : lines) file << line;
  file.flush();
  if (!file) {
    log::error("bridge: cannot append to outbox " + config_.outbox_path);
    return false;
  }
  return true;
}

void BridgeClient::close() { close_socket(false); }

void BridgeClient::close_socket(bool unclean) {
  if (fd_ >= 0) {
    ::close(fd_);
    keep_unsent(unclean);  // a drone restart replays them from the outbox
  }
  fd_ = -1;
  connecting_ = false;
  inbox_.clear();
}

}  // namespace drone
