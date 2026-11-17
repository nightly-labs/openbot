### Fixed

- When you asked for a provider restart and a provider update while agents worked, new messages
  waited for each one separately. Cancel on the update did not release them: the restart still held
  them, and the provider showed Connected. Now the update also does the restart, so one wait holds the
  messages and one Cancel releases them. A restart that you cancel with the update runs later, when
  the provider's tasks stop, and new messages do not wait for it. On a joined server, the server must
  also be on this version.
