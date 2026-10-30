### Added

- Log in to ChatGPT with an OpenAI API key. On this computer, open Settings > Providers > ChatGPT and select Add key under API key. Codex saves the key, and OpenAI bills each request to it instead of your ChatGPT plan. Change key replaces it, and Disconnect removes it.

### Fixed

- ChatGPT agents now run when Codex signs in with an OpenAI API key, also with `codex login --with-api-key` in a terminal. Before, OpenBot showed "Codex requires a ChatGPT subscription login" and did not start Codex. Connect now uses that login too, and does not open a ChatGPT sign-in.
