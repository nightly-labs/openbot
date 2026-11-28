### Fixed

- When OpenAI answers a GPT live voice call with a 404 error, the voice panel now says "OpenAI could not start live voice. The problem is on OpenAI's side. Try again later." Before, it showed the raw Codex error "unexpected status 404 Not Found: realtime websocket handshake failed". The technical details stay in the log. On a joined server, the server must also be on this version.
