### Fixed

- Compact idle Pi, DeepSeek, Inception and OpenRouter chats after their provider restarts. Before,
  background compaction could fail with "cwd is required." and stop after two attempts.
