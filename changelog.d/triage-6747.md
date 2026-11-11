### Fixed

- Agents can read online videos on a computer that connects to the internet through a proxy. Before, OpenBot downloaded its video tool without the computer's proxy settings, so the download failed and the agent got "Check the internet connection", but the built-in browser opened the same link. The download now uses the same proxy settings as the built-in browser.
