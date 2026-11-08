#pragma once

// Local operator socket (docs/specs/robot.md section 10.4): a Unix socket that `robotctl` talks to.
// One JSON object per line (NDJSON) each way, for example:
//   -> {"cmd":"estop"}
//   <- {"ok":true,"queued":"estop"}
//
// Everything is non-blocking: poll() accepts, reads what is waiting, and returns whole lines.
// It is called once per tick from the main loop and never waits.
// This socket is local only. E-stop reset is possible here and never from SpacetimeDB.

#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace robot {

struct ControlRequest {
  int client = -1;  // pass back to reply()
  nlohmann::json body;
};

class ControlServer {
 public:
  ControlServer() = default;
  ~ControlServer();
  ControlServer(const ControlServer&) = delete;
  ControlServer& operator=(const ControlServer&) = delete;

  // Creates the parent folder, removes a stale socket file, and listens. Returns false with `error` set.
  bool start(const std::string& path, std::string* error);
  std::vector<ControlRequest> poll();
  void reply(int client, const nlohmann::json& body);
  void stop();

 private:
  struct Client {
    int fd;
    std::string inbox;
  };
  void close_client(std::size_t index);

  std::string path_;
  int listen_fd_ = -1;
  std::vector<Client> clients_;
};

}  // namespace robot
