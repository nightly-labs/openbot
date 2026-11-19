### Fixed

- When an OpenCode model writes a reply that is longer than its output limit three times, the chat
  now says what happened and what to do: set a larger Max output for a custom endpoint model, or
  choose a lower effort or another model. Before, the chat showed only "Internal error: Response
  still truncated after two output token limit continuations".
