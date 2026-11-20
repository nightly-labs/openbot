### Fixed

- When a queued message waits because the agent's provider is not signed in, the queue now says
  "Waiting - <provider> needs sign-in" instead of only "Queued". A side thread or routine task that
  waits for the sign-in also says "Waiting. The provider of this agent needs sign-in." When queued
  work, such as a routine run, waits for that sign-in, OpenBot also sends one push notification to
  your phone: "<agent>: Waits for <provider> sign-in." It does not send it again until the provider is
  signed in and then signs out again. The host log line for a waiting message now names the provider.
  On a joined server, the server must also be on this version.
