### Fixed

- A WhatsApp, Slack or Telegram contact no longer gets an internal result between agents, such as
  "Status: done, Result: …, Evidence: …". When a teammate asked the agent of a chat a question back,
  the agent wrote its result for the teammate as a chat answer, and OpenBot posted it to the contact.
  Now the result goes only to the teammate. The contact gets a message only when the agent must ask
  them something, and no "OpenBot finished without a written answer" notice.
