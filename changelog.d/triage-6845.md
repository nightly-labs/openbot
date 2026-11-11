### Fixed

- A Codex chat that stays almost full after a compaction no longer compacts again after each turn. Before, Codex reported a small estimate while it compacted, so OpenBot did not see that the compaction freed no space. The chat compacted without end, with no Stop button and no message. Now OpenBot stops after 2 such compactions and tells you to start a new chat.
