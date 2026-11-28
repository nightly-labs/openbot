### Fixed

- Agents on Gemini (Antigravity) can send messages and use OpenBot tools again when the model wraps a
  tool call in a second copy of the same call. Before, the tool failed and the agent tried the same
  call again and again.
