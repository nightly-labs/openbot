### Fixed

- An agent that answers in Telegram, Slack, Discord or WhatsApp now tells the chat the result of work
  that it ran in the background, such as a voice transcription. Before, the result stayed in OpenBot,
  the chat showed no status and no Stop button, and new messages got "Too many requests are waiting"
  until the agent finished. Now the chat shows "Working on it…" with Stop, and gets the answer. The
  first new message in the chat during this work also gets the "Waiting" message. On a joined server,
  the server must also have this version.
