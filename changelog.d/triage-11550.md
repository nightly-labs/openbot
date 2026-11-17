### Fixed

- A confirm card stays open, and you get it only one time, when the agent's provider cannot wait for
  your answer, such as Mistral Vibe or Cursor. Before, the agent got an error after 60 seconds while
  the card was still open, and it asked the same question again. In a routine that runs in its own
  thread, your answer now goes to that thread. If you edit the text in the card, the agent gets the
  text that you edited.
