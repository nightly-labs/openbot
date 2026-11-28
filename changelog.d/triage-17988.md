### Fixed

- Download many large attachments at once from a joined server in the phone app, at openbot.run/app,
  or in a desktop app joined over Signal. Before, when the files were more than about 350 MB in
  total, some of them failed with "Download failed" and the message "The active file set is larger
  than 250 MB." Now the server waits until there is room, and each file downloads. The server must
  also be on this version.
