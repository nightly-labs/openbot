### Fixed

- A file chip that joins a file name to a folder in the same message now opens the file as the agent wrote it, from the agent workspace, when the folder does not have it. Before, `test/p1.txt` after a Shared folder failed with "Nothing exists at …".
- A file chip with only a file name now finds a file that a Pi agent read, wrote or edited in the same thread, also outside its workspace, as it does for Claude and ACP agents.
