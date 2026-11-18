### Fixed

- A Claude server error, such as "529 Overloaded", no longer shows "Usage limit reached" while Claude
  continues on extra usage. The chat now says "Provider error", and OpenBot does not hold the Claude
  model until the usage window resets. A backup model still takes the message as before.
