### Fixed

- When a site such as X refuses a sign-in from the server, the sign-in card in the web client now
  says to sign in from the OpenBot desktop app on your computer. Before, I'm done on a phone or in
  a web browser told the agent that the sign-in was complete, but the server browser stayed signed
  out. The agent now checks the page again and asks you to sign in from the desktop app.
  **The server must also be on this version for the agent to know that no sign-in came.**
