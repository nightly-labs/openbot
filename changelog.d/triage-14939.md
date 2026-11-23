### Fixed

- A Gemini (Antigravity) routine run with nothing to report now ends in one step and leaves no text in
  the chat. Before, Antigravity CLI 1.5.14 refused the empty answer, so the agent tried again and its
  extra reply, such as "No updates.", stayed in the run.
