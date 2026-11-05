### Fixed

- Stop asking for automatic compactions of a ChatGPT (Codex), Muse, Pi or Antigravity chat that
  stays at 80% or more of its context window after each compaction. Before, OpenBot stopped only
  at 90% or more, so a chat that stayed at about 84% compacted again and again and used up the
  plan limit. Now OpenBot stops after 2 such compactions and shows the notice that the compaction
  does not make the chat smaller. "Compact now" and "New chat" stay available.
