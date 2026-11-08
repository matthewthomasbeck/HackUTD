// Logger contract: a stalled output (an unread stderr pipe) never blocks the caller.
// The 2026-11-08 audit stalled the main loop for over 2 s this way with the old fprintf logger.

#include <chrono>
#include <cstdio>
#include <string>
#include <thread>

#include <unistd.h>

#include <gtest/gtest.h>

#include "core/log.hpp"

namespace robot {
namespace {

using namespace std::chrono_literals;

TEST(Log, StalledOutputDoesNotBlockTheCaller) {
  int fds[2];
  ASSERT_EQ(pipe(fds), 0);
  std::FILE* stalled = fdopen(fds[1], "w");
  ASSERT_NE(stalled, nullptr);
  log::set_output(stalled);

  // Nobody reads the pipe, so the writer thread blocks once the pipe buffer fills (about 64 KB).
  // 20,000 lines of about 100 bytes is far past that plus the queue limit.
  const std::size_t dropped_before = log::dropped_total();
  const std::string filler(80, 'x');
  const auto start = std::chrono::steady_clock::now();
  for (int i = 0; i < 20000; ++i) log::info(filler);
  const auto elapsed = std::chrono::steady_clock::now() - start;

  EXPECT_LT(elapsed, 500ms);  // the old logger never returned here
  EXPECT_GT(log::dropped_total(), dropped_before);

  // Drain the pipe so the writer thread can finish, then put stderr back.
  std::thread reader([fd = fds[0]] {
    char buf[4096];
    while (read(fd, buf, sizeof(buf)) > 0) {
    }
  });
  log::flush();
  log::set_output(stderr);
  std::fclose(stalled);  // EOF for the reader
  reader.join();
  close(fds[0]);
}

TEST(Log, FlushWritesQueuedLinesInOrder) {
  std::FILE* tmp = std::tmpfile();
  ASSERT_NE(tmp, nullptr);
  log::set_output(tmp);
  log::info("first");
  log::warn("second");
  log::debug("hidden at the default Info level");
  log::flush();
  log::set_output(stderr);

  std::rewind(tmp);
  std::string all;
  char buf[256];
  while (std::fgets(buf, sizeof(buf), tmp)) all += buf;
  std::fclose(tmp);

  const auto first = all.find("[I] first");
  const auto second = all.find("[W] second");
  ASSERT_NE(first, std::string::npos);
  ASSERT_NE(second, std::string::npos);
  EXPECT_LT(first, second);
  EXPECT_EQ(all.find("hidden"), std::string::npos);
}

}  // namespace
}  // namespace robot
