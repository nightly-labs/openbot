### Fixed

- A long chat no longer shows an error such as "Pi request timed out: get_messages" above the
  message field after the app starts. OpenBot reads the provider's copy of the chat in the
  background, and a slow read showed this error, which stayed visible. The chat was complete before
  and is complete now, and the next start reads the provider's copy again.
