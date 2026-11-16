### Fixed

- When Claude Code cannot find the saved session of a chat, for example after you change the agent's
  Claude account, the agent now answers your message in a new session with the chat history. You do
  not have to send the message again. The same occurs one time for the other Claude errors that make
  OpenBot start a new session, such as a chat that is too large.
