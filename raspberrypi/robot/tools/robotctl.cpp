// robotctl: command-line client for the robot's local control socket.
//
//   robotctl [--socket PATH] status
//   robotctl start [KIND]          (KIND defaults to hold)
//   robotctl stop | estop | reset
//   robotctl start seek_thermal     find a warm shape and drive up to it
//   robotctl mock thermal_blob off|COLUMN   (laptop mocks: a fake warm body at column 0..31)
//   robotctl start teleop | drive VX VY WZ [SECONDS] | teleop   (remote driving, keyboard)
//   robotctl mock pico_link lost|ok
//   robotctl mock estop_sense on|off
//   robotctl mock stale DEVICE on|off
//   robotctl mock init DEVICE OK|DEGRADED|FAILED
//   robotctl test_detection [MISSION_ID]   TEST HOOK: one fake detection to the bridge (task R3 check)
//
// Sends one JSON line, prints the one-line reply, and exits 0 if the reply says ok.

#include <sys/socket.h>
#include <sys/time.h>
#include <sys/un.h>
#include <unistd.h>

#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <algorithm>
#include <termios.h>
#include <thread>
#include <csignal>
#include <chrono>
#include <atomic>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

using json = nlohmann::json;

namespace {

int usage() {
  std::fprintf(stderr,
               "usage: robotctl [--socket PATH] status | start [KIND] | stop | estop | reset\n"
               "       robotctl mock pico_link lost|ok | mock estop_sense on|off\n"
               "       robotctl mock stale DEVICE on|off | mock init DEVICE OK|DEGRADED|FAILED\n"
               "       robotctl test_detection [MISSION_ID]   (test hook: one fake detection)\n"
               "       robotctl drive VX VY WZ [SECONDS]      (m/s, m/s, deg/s; needs a teleop mission)\n"
               "       robotctl teleop                        (drive with the keyboard; start teleop first)\n");
  return 2;
}

// Sends one request and returns the parsed reply (empty object on failure, after printing why).
json send_request(const std::string& socket_path, const json& request) {
  const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
  sockaddr_un addr{};
  addr.sun_family = AF_UNIX;
  std::strncpy(addr.sun_path, socket_path.c_str(), sizeof(addr.sun_path) - 1);
  if (fd < 0 || ::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
    std::fprintf(stderr, "robotctl: cannot connect to %s: %s (is the robot running?)\n", socket_path.c_str(),
                 std::strerror(errno));
    if (fd >= 0) ::close(fd);
    return json::object();
  }
  timeval timeout{2, 0};  // the robot answers within a tick or two
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
  const std::string line = request.dump() + "\n";
  if (::send(fd, line.data(), line.size(), 0) != static_cast<ssize_t>(line.size())) {
    std::fprintf(stderr, "robotctl: send failed: %s\n", std::strerror(errno));
    ::close(fd);
    return json::object();
  }
  std::string reply;
  char buffer[4096];
  while (reply.find('\n') == std::string::npos) {
    const ssize_t n = ::recv(fd, buffer, sizeof(buffer), 0);
    if (n <= 0) {
      std::fprintf(stderr, "robotctl: no reply from the robot\n");
      ::close(fd);
      return json::object();
    }
    reply.append(buffer, static_cast<std::size_t>(n));
  }
  ::close(fd);
  const json body = json::parse(reply.substr(0, reply.find('\n')), nullptr, false);
  if (body.is_discarded()) {
    std::fprintf(stderr, "robotctl: bad reply: %s\n", reply.c_str());
    return json::object();
  }
  return body;
}

std::atomic<bool> g_quit{false};
void on_signal(int) { g_quit = true; }

json drive_cmd(double vx, double vy, double wz) { return {{"cmd", "drive"}, {"vx", vx}, {"vy", vy}, {"wz", wz}}; }

// Re-sends one command 10 times a second for `seconds` (the robot's dead-man needs a steady stream),
// then a zero command. Ctrl+C stops at once.
int run_drive(const std::string& socket_path, double vx, double vy, double wz, double seconds) {
  std::signal(SIGINT, on_signal);
  const auto end = std::chrono::steady_clock::now() + std::chrono::duration<double>(std::min(seconds, 30.0));
  bool noted = false;
  while (!g_quit && std::chrono::steady_clock::now() < end) {
    const json r = send_request(socket_path, drive_cmd(vx, vy, wz));
    if (!r.value("ok", false)) return 1;
    if (r.contains("note") && !noted) {
      std::printf("%s\n", r["note"].get<std::string>().c_str());
      noted = true;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
  send_request(socket_path, drive_cmd(0, 0, 0));
  return 0;
}

// Keyboard driving. Holding a key keeps the robot moving (the terminal's key repeat re-sends it);
// let go and it stops within ~0.3 s. Speeds are 0.15 m/s and 30 deg/s; the robot's limits still apply.
int run_teleop(const std::string& socket_path) {
  std::signal(SIGINT, on_signal);
  termios old{};
  if (tcgetattr(STDIN_FILENO, &old) != 0) {
    std::fprintf(stderr, "robotctl teleop needs a terminal\n");
    return 1;
  }
  termios raw = old;
  raw.c_lflag &= ~static_cast<tcflag_t>(ICANON | ECHO);
  raw.c_cc[VMIN] = 0;
  raw.c_cc[VTIME] = 0;
  tcsetattr(STDIN_FILENO, TCSANOW, &raw);
  std::printf("Driving. w/s forward/back, a/d strafe left/right, q/e turn left/right, space stop, x quit.\n"
              "Hold a key to keep moving; let go and the robot stops.\n");
  const double v = 0.15, w = 30;
  double vx = 0, vy = 0, wz = 0;
  auto last_key = std::chrono::steady_clock::now() - std::chrono::seconds(1);
  bool noted = false;
  while (!g_quit) {
    char c = 0;
    while (::read(STDIN_FILENO, &c, 1) == 1) {
      last_key = std::chrono::steady_clock::now();
      vx = vy = wz = 0;
      switch (c) {
        case 'w': vx = v; break;
        case 's': vx = -v; break;
        case 'a': vy = v; break;
        case 'd': vy = -v; break;
        case 'q': wz = w; break;
        case 'e': wz = -w; break;
        case 'x': g_quit = true; break;
        default: break;  // space or anything else: stop
      }
    }
    // Key repeat has a ~0.5 s delay before it starts; 0.6 s keeps a held key moving smoothly.
    if (std::chrono::steady_clock::now() - last_key > std::chrono::milliseconds(600)) vx = vy = wz = 0;
    const json r = send_request(socket_path, drive_cmd(vx, vy, wz));
    if (!r.value("ok", false)) break;
    if (r.contains("note") && !noted) {
      std::printf("\r%s\n", r["note"].get<std::string>().c_str());
      noted = true;
    }
    std::printf("\r  vx %+.2f m/s  vy %+.2f m/s  wz %+3.0f deg/s   ", vx, vy, wz);
    std::fflush(stdout);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
  send_request(socket_path, drive_cmd(0, 0, 0));
  tcsetattr(STDIN_FILENO, TCSANOW, &old);
  std::printf("\nstopped\n");
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  std::string socket_path = "/run/robot/control.sock";
  std::vector<std::string> words;
  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    if (a == "--socket" && i + 1 < argc) {
      socket_path = argv[++i];
    } else {
      words.push_back(a);
    }
  }
  if (words.empty()) return usage();

  json request;
  const std::string& cmd = words[0];
  if ((cmd == "status" || cmd == "stop" || cmd == "estop" || cmd == "reset") && words.size() == 1) {
    request = {{"cmd", cmd}};
  } else if (cmd == "start" && words.size() <= 2) {
    request = {{"cmd", "start"}, {"kind", words.size() == 2 ? words[1] : "hold"}};
  } else if (cmd == "test_detection" && words.size() <= 2) {
    request = {{"cmd", "test_detection"}};
    if (words.size() == 2) {
      char* end = nullptr;
      const unsigned long long id = std::strtoull(words[1].c_str(), &end, 10);
      if (end == words[1].c_str() || *end != '\0' || id == 0) return usage();
      request["mission_id"] = static_cast<std::uint64_t>(id);
    }
  } else if (cmd == "drive" && (words.size() == 4 || words.size() == 5)) {
    const double secs = words.size() == 5 ? std::atof(words[4].c_str()) : 1.0;
    return run_drive(socket_path, std::atof(words[1].c_str()), std::atof(words[2].c_str()), std::atof(words[3].c_str()), secs);
  } else if (cmd == "teleop" && words.size() == 1) {
    return run_teleop(socket_path);
  } else if (cmd == "mock" && words.size() == 3) {
    request = {{"cmd", "mock"}, {"what", words[1]}, {"value", words[2]}};
  } else if (cmd == "mock" && words.size() == 4) {
    request = {{"cmd", "mock"}, {"what", words[1]}, {"device", words[2]}, {"value", words[3]}};
  } else {
    return usage();
  }

  const json body = send_request(socket_path, request);
  if (body.empty()) return 1;
  std::printf("%s\n", body.dump(2).c_str());
  return body.value("ok", false) ? 0 : 1;
}
