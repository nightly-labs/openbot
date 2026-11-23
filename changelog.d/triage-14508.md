### Fixed

- In a long chat, the app no longer says that the provider sent no update while the provider compacts
  the context. Before, after one minute, "ChatGPT has sent no update for 1 minute." and "Waiting for
  ChatGPT…" showed together with "Compacting context", so a working agent looked stuck. Now the chat
  shows only "Compacting context" with its timer. When the compaction ends, the one-minute count
  starts again.
