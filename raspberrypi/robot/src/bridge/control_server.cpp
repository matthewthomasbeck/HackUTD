#include "bridge/control_server.hpp"

#include <fcntl.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <filesystem>

#include "core/log.hpp"

namespace robot {

namespace {

constexpr std::size_t kMaxLine = 4096;
constexpr std::size_t kMaxClients = 8;

bool set_non_blocking(int fd) {
  const int flags = fcntl(fd, F_GETFL, 0);
  return flags >= 0 && fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0;
}

// Never let a dead client kill the robot with SIGPIPE (macOS has no MSG_NOSIGNAL).
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

}  // namespace

ControlServer::~ControlServer() { stop(); }

bool ControlServer::start(const std::string& path, std::string* error) {
  sockaddr_un addr{};
  if (path.size() >= sizeof(addr.sun_path)) {
    *error = "control socket path too long: " + path;
    return false;
  }
  std::error_code ec;
  std::filesystem::create_directories(std::filesystem::path(path).parent_path(), ec);
  ::unlink(path.c_str());  // a stale socket file from a crash would make bind fail

  listen_fd_ = ::socket(AF_UNIX, SOCK_STREAM, 0);
  if (listen_fd_ < 0) {
    *error = std::string("socket: ") + std::strerror(errno);
    return false;
  }
  addr.sun_family = AF_UNIX;
  std::strncpy(addr.sun_path, path.c_str(), sizeof(addr.sun_path) - 1);
  if (::bind(listen_fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0 || ::listen(listen_fd_, 4) != 0 ||
      !set_non_blocking(listen_fd_)) {
    *error = "cannot listen on " + path + ": " + std::strerror(errno);
    stop();
    return false;
  }
  path_ = path;
  return true;
}

std::vector<ControlRequest> ControlServer::poll() {
  std::vector<ControlRequest> requests;
  if (listen_fd_ < 0) return requests;

  // Accept everyone waiting.
  while (true) {
    const int fd = ::accept(listen_fd_, nullptr, nullptr);
    if (fd < 0) break;  // EAGAIN: nobody else waiting
    if (clients_.size() >= kMaxClients || !set_non_blocking(fd)) {
      ::close(fd);
      continue;
    }
    no_sigpipe(fd);
    clients_.push_back({fd, ""});
  }

  // Read what each client sent, split into lines. Walk backwards so closing one is safe.
  for (std::size_t i = clients_.size(); i-- > 0;) {
    char buffer[1024];
    bool closed = false;
    while (true) {
      const ssize_t n = ::recv(clients_[i].fd, buffer, sizeof(buffer), 0);
      if (n > 0) {
        clients_[i].inbox.append(buffer, static_cast<std::size_t>(n));
        continue;
      }
      if (n == 0 || (errno != EAGAIN && errno != EWOULDBLOCK)) closed = true;
      break;
    }

    const std::size_t requests_before = requests.size();
    std::string& inbox = clients_[i].inbox;
    std::size_t newline;
    while ((newline = inbox.find('\n')) != std::string::npos) {
      const std::string line = inbox.substr(0, newline);
      inbox.erase(0, newline + 1);
      if (line.empty()) continue;
      nlohmann::json body = nlohmann::json::parse(line, nullptr, false);
      if (body.is_discarded() || !body.is_object()) {
        reply(clients_[i].fd, {{"ok", false}, {"error", "not a JSON object"}});
        continue;
      }
      requests.push_back({clients_[i].fd, std::move(body)});
    }
    if (inbox.size() > kMaxLine) closed = true;  // no newline in 4 KB: not a robotctl client
    // A client that hung up right after sending keeps its socket until its reply is written;
    // the next poll() sees the hang-up again and closes it then.
    if (closed && requests.size() == requests_before) close_client(i);
  }
  return requests;
}

void ControlServer::reply(int client, const nlohmann::json& body) {
  const std::string line = body.dump() + "\n";
  // Best effort, non-blocking: replies are small, and a client that cannot take them is dropped.
  const ssize_t n = ::send(client, line.data(), line.size(), kSendFlags);
  if (n != static_cast<ssize_t>(line.size())) {
    for (std::size_t i = 0; i < clients_.size(); ++i) {
      if (clients_[i].fd == client) {
        close_client(i);
        break;
      }
    }
  }
}

void ControlServer::close_client(std::size_t index) {
  ::close(clients_[index].fd);
  clients_.erase(clients_.begin() + static_cast<std::ptrdiff_t>(index));
}

void ControlServer::stop() {
  for (std::size_t i = clients_.size(); i-- > 0;) close_client(i);
  if (listen_fd_ >= 0) {
    ::close(listen_fd_);
    listen_fd_ = -1;
  }
  if (!path_.empty()) {
    ::unlink(path_.c_str());
    path_.clear();
  }
}

}  // namespace robot
