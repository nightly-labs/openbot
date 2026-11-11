### Fixed

- When a Grok model answers with only blank text, the chat now says that Grok ended the turn with no
  answer, and tells you to send the message again. Before, the turn ended as done, and the chat showed
  no reply and no error.
