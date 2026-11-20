### Fixed

- When a teammate sent one more result, with different text, for a request that a ChatGPT or Claude
  agent already took, and the agent had nothing to add, OpenBot ran the turn again and then showed
  "ChatGPT ended the turn with no answer. Send the message again, or start a new chat." Now that turn
  ends quietly, and the teammate's new result stays in the chat.
