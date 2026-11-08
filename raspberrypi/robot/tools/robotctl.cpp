// robotctl: command-line client for the robot's local control socket.
//
//   robotctl [--socket PATH] status
//   robotctl start [KIND]          (KIND defaults to hold)
//   robotctl stop | estop | reset
//   robotctl start seek_thermal     find a warm shape and drive up to it
//   robotctl mock thermal_blob off|COLUMN   (laptop mocks: a fake warm body at column 0..31)
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
               "       robotctl test_detection [MISSION_ID]   (test hook: one fake detection)\n");
  return 2;
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
  } else if (cmd == "mock" && words.size() == 3) {
    request = {{"cmd", "mock"}, {"what", words[1]}, {"value", words[2]}};
  } else if (cmd == "mock" && words.size() == 4) {
    request = {{"cmd", "mock"}, {"what", words[1]}, {"device", words[2]}, {"value", words[3]}};
  } else {
    return usage();
  }

  const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
  sockaddr_un addr{};
  addr.sun_family = AF_UNIX;
  std::strncpy(addr.sun_path, socket_path.c_str(), sizeof(addr.sun_path) - 1);
  if (fd < 0 || ::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
    std::fprintf(stderr, "robotctl: cannot connect to %s: %s (is the robot running?)\n", socket_path.c_str(),
                 std::strerror(errno));
    return 1;
  }

  // The robot answers within a tick or two; give up after 2 s.
  timeval timeout{2, 0};
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));

  const std::string line = request.dump() + "\n";
  if (::send(fd, line.data(), line.size(), 0) != static_cast<ssize_t>(line.size())) {
    std::fprintf(stderr, "robotctl: send failed: %s\n", std::strerror(errno));
    return 1;
  }

  std::string reply;
  char buffer[4096];
  while (reply.find('\n') == std::string::npos) {
    const ssize_t n = ::recv(fd, buffer, sizeof(buffer), 0);
    if (n <= 0) {
      std::fprintf(stderr, "robotctl: no reply from the robot\n");
      return 1;
    }
    reply.append(buffer, static_cast<std::size_t>(n));
  }
  ::close(fd);

  const json body = json::parse(reply.substr(0, reply.find('\n')), nullptr, false);
  if (body.is_discarded()) {
    std::fprintf(stderr, "robotctl: bad reply: %s\n", reply.c_str());
    return 1;
  }
  std::printf("%s\n", body.dump(2).c_str());
  return body.value("ok", false) ? 0 : 1;
}
