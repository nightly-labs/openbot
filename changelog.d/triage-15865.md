### Fixed

- OpenBot opens when one saved message or queue item cannot be read. Before, the app stopped each
  time with "Stored mailbox projection is invalid." and did not open. OpenBot now leaves out only
  that item and keeps it on the disk, and all other agents and chats open as before.
