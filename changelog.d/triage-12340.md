### Fixed

- A Gemini agent with Full access and Computer Use on can now list, read, and click windows. The
  Gemini CLI gives the agent only some Computer Use tools, and OpenBot did not run the others when the
  agent asked for them. Now OpenBot runs them in the Computer Use process of the session, with the
  same approval as the other tools. An agent with Workspace only access does not change. On a joined
  server, the server must also be on this version.
