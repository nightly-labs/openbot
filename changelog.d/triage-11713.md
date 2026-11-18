### Fixed

- When the ChatGPT sign-in had stopped working, an update of the ChatGPT CLI failed with "ChatGPT did
  not return an authenticated account." and ChatGPT still showed as connected. The update now
  finishes, and ChatGPT shows "Connect ChatGPT to continue." so that you can sign in again. On a
  joined server, the server must also be on this version.
- ChatGPT connects again by itself when its sign-in comes back, such as after `codex login` in a
  terminal or over SSH. You no longer need to click Connect or restart OpenBot.
- Retry after a failed provider CLI update no longer downloads the CLI again. It installs the copy
  that the first try downloaded.

### Changed

- OpenBot now includes ChatGPT CLI (Codex) 0.170.0.
