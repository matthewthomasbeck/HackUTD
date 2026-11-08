#pragma once

// The drone's side of the local socket to the Node.js bridge (docs/specs/robot.md sections 9 and
// 10.2, CONTRACTS.md "Robot bridge local protocol"). NDJSON over a Unix socket; the bridge
// listens, we connect.
//
// The main loop must never wait on the bridge, so:
//   - The socket is non-blocking, and poll() is called once per tick. It connects if it is time,
//     reads what is waiting, writes what fits, and returns. A partial write keeps the rest of the
//     line for the next poll.
//   - Outgoing lines wait in two bounded queues, sent in the order they were queued:
//       telemetry  heartbeat, position: capacity 64, the oldest is dropped when full
//       important  detection, cell, mission_progress, device:
//                  capacity 256, oldest dropped with an error log
//     Telemetry is current state: it is not queued while disconnected, and the queue is cleared
//     when the link drops, because the main loop sends a fresh heartbeat and position on connect.
//   - While the bridge is gone, important lines are appended to the outbox file instead
//     (bridge.outbox), and the ones still queued when the link drops are moved there too.
//     Device lines are the exception: they are current state, and the main loop resends every
//     device after each connect, so they are not queued while disconnected and never replayed.
//   - On the next connect (also after a drone restart) the outbox is renamed to
//     `<outbox>.replaying` and replayed first, at most important_capacity lines loaded at a time.
//     The .replaying file is deleted only after its last line is fully written, so a crash or a
//     watchdog kill during the replay replays it again on the next connect (before the newer
//     outbox). A line can arrive twice; the bridge dedupes detections by client_ref and rejects a
//     repeated cell or mission_progress harmlessly.
//   - "Written" means send() put the line in the kernel socket buffer, not that the bridge read
//     it. So the last resend_on_drop important lines written on this connection are kept, and an
//     unclean drop (read or write error, or EOF) puts them back in the outbox to replay. close()
//     is a clean shutdown and does not. The bridge's own spool covers SpacetimeDB outages.
//   - A failed connect waits 0.5 s, then 1, 2, 4, and 5 s between tries (backoff resets on connect).
//   - A dead peer never raises SIGPIPE (MSG_NOSIGNAL on Linux, SO_NOSIGPIPE on macOS).
//
// The outbox is a small append on a rare message (detections and cells, while disconnected), and
// the replay reads one batch at a time; there is no fsync, so these writes do not stall the loop
// (a power cut can lose the last few appended lines).

#include <cstddef>
#include <cstdint>
#include <deque>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "bridge/messages.hpp"
#include "core/clock.hpp"

namespace drone {

struct BridgeClientConfig {
  std::string socket_path;  // bridge.socket
  std::string outbox_path;  // bridge.outbox; empty disables the outbox
  std::size_t telemetry_capacity = 64;
  std::size_t important_capacity = 256;
  double backoff_initial_ms = 500;
  double backoff_max_ms = 5000;
  std::size_t max_inbound_per_poll = 16;  // the rest stays buffered for the next tick
  std::size_t resend_on_drop = 32;        // important lines written, replayed after an unclean drop
};

class BridgeClient {
 public:
  explicit BridgeClient(BridgeClientConfig config);
  ~BridgeClient();
  BridgeClient(const BridgeClient&) = delete;
  BridgeClient& operator=(const BridgeClient&) = delete;

  // Queues one message; the queue comes from is_important_message(). Never blocks.
  void send(const nlohmann::json& message);

  // Once per tick: connect when due, read, write. Returns the bridge messages that arrived.
  std::vector<InboundMessage> poll(SteadyTime now);

  bool connected() const { return fd_ >= 0 && !connecting_; }
  // True once after each new connection, so the main loop can resend the device list.
  bool take_reconnected();

  std::size_t telemetry_queued() const { return telemetry_.size(); }
  std::size_t important_queued() const { return important_.size() + replay_.size(); }
  std::size_t telemetry_dropped() const { return telemetry_dropped_; }
  std::size_t important_dropped() const { return important_dropped_; }
  double backoff_ms() const { return backoff_ms_; }

  // Closes the socket; unsent important lines go to the outbox. The destructor calls it.
  void close();

 private:
  struct Entry {
    std::uint64_t order;  // queue order across both queues
    std::string line;     // with the trailing newline
    bool replayable = true;  // goes to the outbox if unsent (false for device lines)
  };

  void try_connect(SteadyTime now);
  void finish_connect(SteadyTime now);
  void on_connected();
  void disconnect(SteadyTime now, const std::string& why);  // an unclean drop
  void close_socket(bool unclean);
  std::size_t keep_unsent(bool unclean);  // unsent important lines to the outbox (or back to memory)
  void schedule_retry(SteadyTime now);
  void read_inbound(SteadyTime now, std::vector<InboundMessage>* out);
  void write_outbound(SteadyTime now);
  bool next_line();  // moves the next queued line into current_; false if nothing is queued
  bool append_outbox(const std::vector<std::string>& lines);  // false if the disk write failed
  std::string replaying_path() const { return config_.outbox_path + ".replaying"; }
  void start_replay();       // on connect: outbox to .replaying, then the first batch
  void load_replay_batch();  // the next batch from .replaying; deletes it when nothing is left

  BridgeClientConfig config_;
  int fd_ = -1;
  bool connecting_ = false;  // connect() returned EINPROGRESS
  bool reconnected_ = false;
  double backoff_ms_;
  SteadyTime next_attempt_{};
  std::string last_connect_error_;

  std::uint64_t next_order_ = 0;
  std::deque<Entry> telemetry_;
  std::deque<Entry> important_;
  std::deque<std::string> replay_;  // the loaded batch of the .replaying file, sent before everything else
  bool replay_active_ = false;      // the .replaying file still has lines not fully written
  std::uintmax_t replay_offset_ = 0;  // bytes of the .replaying file already loaded
  std::deque<std::string> recent_sent_;  // the last important lines written on this connection
  std::string current_;             // the line being written
  std::size_t current_sent_ = 0;
  bool current_important_ = false;
  bool current_replayable_ = false;
  bool current_from_file_ = false;  // from the .replaying file, which still holds it
  std::size_t telemetry_dropped_ = 0;
  std::size_t important_dropped_ = 0;

  std::string inbox_;  // bytes read but not yet a whole line
};

}  // namespace drone
