### Fixed

- Stop asking for automatic compactions of a ChatGPT (Codex), Muse, Pi or Antigravity chat after 2
  compactions in a row fail or time out. Before, each failed compaction let the next turn ask for
  another one. One chat compacted every 19 seconds for 7 hours overnight and used up the plan limit.
  OpenBot now shows a notice and stops. "Compact now" and "New chat" stay available. A compaction
  that completes, or a chat that falls below 80% of its window, starts the count again.
- A message sent after OpenBot stopped a compaction that Codex did not stop no longer asks for a new
  compaction at once. It waits for the running compaction to end.
