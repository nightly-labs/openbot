### Fixed

- Compact the long chats of idle Pi, DeepSeek, Inception and OpenRouter agents again. Before, after
  OpenBot stopped the idle provider, the compaction failed with "cwd is required." and stopped after
  two tries. On a joined server, the server must also be on this version.
