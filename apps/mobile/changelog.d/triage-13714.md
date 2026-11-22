### Fixed

- On Android, a file that the app could not read was sent to the agent as a 14-byte "File not found" file, with no error. The app now shows "The attachment is unavailable. Try again." and does not send the file.
