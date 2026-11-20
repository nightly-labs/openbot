### Fixed

- When queued work, such as a routine run, waits because the agent's provider is not signed in, the
  queue now says "Waiting - <provider> needs sign-in" instead of only "Queued". OpenBot also sends one
  push notification to your phone: "<agent>: Waits for <provider> sign-in." It does not send it again
  until the provider is signed in and then signs out again. The host log line for a waiting message
  now names the provider. On a joined server, the server must also be on this version.
