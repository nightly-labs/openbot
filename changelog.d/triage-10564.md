### Fixed

- WhatsApp: when another OpenBot (on another computer or server) is linked to the same number,
  OpenBot no longer answers that OpenBot's posts in "Message yourself" as your requests. Before,
  the two could answer each other without end. OpenBot now tells you once in the chat, and says how
  to log out the OpenBot that you do not use in WhatsApp's Linked devices.
- WhatsApp: when "Message yourself" gets more than 30 requests in 10 minutes, OpenBot stops answering
  there for 10 minutes and tells you why. This stops a loop before it uses many agent turns. For a
  WhatsApp number on a joined server, the server must also be on the new version.
