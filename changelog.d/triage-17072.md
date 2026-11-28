### Fixed

- A Gemini agent no longer shows "Gemini stopped waiting before the server started" for a local MCP app that starts slowly but then works. OpenBot now shows this message only when the app really does not reach the agent: it stops, it refuses to start, or it does not answer in 60 seconds. The server must be on this version to get the fix.
