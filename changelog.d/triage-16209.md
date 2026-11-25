### Fixed

- Gemini (Antigravity) with a Claude model: when Claude refuses the saved history of a chat because a
  thinking block in the last answer changed, OpenBot now starts a new session with the conversation
  so far and sends your message again. Before, two messages failed with a technical 400 error.
