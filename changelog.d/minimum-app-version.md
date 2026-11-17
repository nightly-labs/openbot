### Changed

- When your desktop app or server is older than the oldest version that OpenBot supports, the app
  shows **Update required** in place of your workspace and installs the update when your agents are
  idle; **Restart to update** installs it at once. A server installs it after its running agent
  turns. OpenBot supports at least the releases of the last 2 months. An app that is offline or
  cannot reach the account service is never blocked. An install that cannot update itself, such as
  a Linux package or Nix, or whose update failed, shows **Download OpenBot** and **Continue without
  updating**, which closes the screen until the next start.
