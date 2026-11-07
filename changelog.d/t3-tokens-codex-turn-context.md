### Changed

- Codex agents get their saved memories and their section teammates with the messages, not in
  the system prompt. When a memory or a section changes, Codex keeps its session and its cached
  prompt, and gets only a short note about the change. Before, a section change started a new
  Codex session, and a memory change reached the agent only in its next new session.
