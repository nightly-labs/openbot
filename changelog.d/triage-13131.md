### Fixed

- A WhatsApp, Slack, Telegram or Discord contact no longer gets an internal result between agents,
  such as "Status: done, Result: …, Evidence: …". When a teammate asked the agent of a chat a
  question back, the agent wrote its result for the teammate as a chat answer, and OpenBot posted it
  to the contact. Now the result goes only to the teammate. While the agent works on the teammate's
  message, the contact sees no "Working on it…" post. The contact gets a message only when the agent
  writes something for them.
