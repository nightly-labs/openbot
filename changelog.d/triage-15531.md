### Fixed

- Servers: when a message waits because the server is low on memory, OpenBot now unloads the idle
  browser tabs of chats that are not working, so the message can start. An unloaded tab loads its
  page again when you or the agent use it. Before, the message waited until you closed tabs
  yourself.
