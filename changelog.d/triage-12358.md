### Fixed

- A Gemini agent answers again when an app, such as Aave, has a tool setting with a fixed list of
  numbers. Before, Google refused each message. Now OpenBot leaves that app out of the chat for the
  Gemini agent, tells you which tool it left out, and sends your message again. When the agent runs
  on a server, the server must also be on this version.
