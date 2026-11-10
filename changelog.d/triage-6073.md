### Fixed

- When a Grok model gives only its reasoning and no answer, the chat now says that Grok ended the turn
  with no answer, and tells you to send the message again. Before, it showed the internal error
  `empty response from model (reasoning_only)`. A turn that does not need an answer, such as a quiet
  routine run, now ends with no error.
