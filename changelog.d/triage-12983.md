### Fixed

- A message that you send to an agent after a pause no longer stays "Not sent" with "Connect Claude to
  continue." when Claude is signed in. Sometimes the provider reports no sign-in for a few seconds when
  OpenBot starts it again after it was idle. The message now waits in the queue, OpenBot checks the
  sign-in again, and the message goes when the provider is ready. The messages that you send after it
  also go. On a joined server, the server must also be on this version.
