### Fixed

- OpenCode Go uses the key that you saved in OpenBot, also when the computer or server has an older
  `OPENCODE_API_KEY`. Before, OpenCode used the older key and OpenBot said that your saved key was refused.
- When OpenCode has its own older OpenCode Go key, the error now says that OpenCode used that key, and
  how to remove it. Before, it told you to paste a new key, which did not help.
