### Fixed

- When you asked for a provider restart and a provider update while agents worked, Cancel on the
  update did not release new messages: the restart still held them, and the provider showed
  Connected. Now Cancel on the update releases them. The restart then runs when the provider's tasks
  stop, and new messages do not wait for it. When the update installs, it also does the restart, so
  the provider does not restart two times. On a joined server, the server must also be on this
  version.
