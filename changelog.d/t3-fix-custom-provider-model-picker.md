### Fixed

- Choose a server's custom provider models from the Custom tab in the desktop app. Before, the model
  picker of a joined server's agent used the endpoints of this computer, so the Custom tab was
  missing and the server's custom models showed on the OpenCode tab.
- When a custom endpoint refuses its API key, or needs a key and has none, the error now names the
  endpoint and tells you to enter the key in Server settings → Providers. Before, it said that
  OpenCode had no sign-in and asked for an OpenCode Go key.
