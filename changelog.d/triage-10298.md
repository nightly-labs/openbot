### Fixed

- When a photo or a file from Telegram, Slack, Discord or WhatsApp does not get to the agent, the
  agent now knows why: the file was too large, there were too many files, or the download failed
  and the sender can send it again. Before, the agent saw only "Files that did not arrive" with no
  reason, and the log had no record of the failure. The log now records the kind of error, without
  the file or the message. A joined server downloads the files of its chats, so the server must
  also be on this version.
