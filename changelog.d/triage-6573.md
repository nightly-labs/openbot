### Fixed

- When OpenAI refuses to start live voice with a 403 error, the voice panel now says so in plain words: try again later, or turn off live voice in Settings to talk by voice. Before, it showed the raw Codex error "unexpected status 403 Forbidden: realtime websocket handshake failed". The technical details stay in the log.
