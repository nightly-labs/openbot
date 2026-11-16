### Fixed

- When Hermes refuses a message before it starts, the chat now says so in plain words and tells you
  what to do. Before, each message failed with only "Internal error: invalid_params". When Hermes
  answered before and then starts to refuse, OpenBot now ends its Hermes process, so your next
  message starts a new one.
