### Fixed

- A team delivery no longer stays in `starting` with no turn id after a restart. A Chisel or Devin ACP session that is gone from the agent store opens a new session. A start that never receives a turn id is interrupted, and a `starting` delivery left by the previous process is interrupted on the next start.
