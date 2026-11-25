### Fixed

- A busy server with many routines no longer stops for seconds at a time. Before, each finished
  turn read 7 days of routine runs, and each message update wrote all the duplicate-send keys again
  and read the full chat of each agent again. Chats, prompts and connected apps were slow to respond.
- The usage report is about 40% faster. While the usage page or the profile activity is open, it
  reloads at most once in 15 seconds, not after each finished turn. On a busy server, this stops
  the reloads from slowing down chats.
