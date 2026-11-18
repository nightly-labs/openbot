### Fixed

- WhatsApp: when another OpenBot (on another computer or server) is linked to the same number,
  OpenBot no longer answers that OpenBot's posts in "Message yourself" as your requests. Before,
  the two could answer each other without end. OpenBot now tells you in the chat, and says how to
  log out the OpenBot that you do not use in WhatsApp's Linked devices.
- WhatsApp: when requests keep coming into "Message yourself" without a break for many minutes,
  as in a loop, OpenBot stops answering there for 10 minutes and tells you why. A burst of messages
  or forwarded files does not do this, and "stop" still works. For a WhatsApp number on a joined
  server, the server must also be on the new version.
