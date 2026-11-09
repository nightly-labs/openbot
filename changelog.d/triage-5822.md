### Fixed

- A ChatGPT agent no longer stays on "Compacting context" with no end when the connection stops during a compaction. After 20 minutes OpenBot stops the turn. When the connection fails or stops during a compaction, the agent continues the task once by itself. When it fails again, a plain message tells you to check your connection and send a message to continue.
