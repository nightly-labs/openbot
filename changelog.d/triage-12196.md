### Fixed

- A linked WhatsApp number no longer stops receiving messages while it still shows "Connected". Before,
  WhatsApp could stop giving messages to OpenBot after some hours, and only Pause and Resume, Reconnect
  or a restart brought them back. Now OpenBot finds a message that it could not finish, or a post that
  WhatsApp did not confirm, and connects again by itself, so the held messages come in. When this occurs
  3 times in an hour, the number shows "Needs attention" with Reconnect. For a number on a joined
  server, the server must also be on this version.
