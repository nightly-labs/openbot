### Added

- Server settings › Transfer can now include the chat history. Each agent's chats and side threads, with the files of their messages, and the messages of each channel move to the new server. The agent continues with the same history after the move. Turn off "Include chat history" for a small file.
- A transfer now moves the channels of the exported agents, with their members, lead, icon, picture, memories, routines and archived state.
- A transfer now moves workflows, the routines that a webhook starts, and the places of routines on each routine canvas. The import tells you which webhook addresses and Slack, Discord or Telegram connections to set up again.
- Each agent now keeps its access, Computer Use, fast mode, backup models, hidden state, pin and notification level when it moves. A setting that gives an agent more than a new agent has, such as "Local scripts", stays off, and the import tells you to turn it on again.

### Changed

- Owners and admins can now move a transfer file of up to 2 GB to and from a joined server, such as a VPS, when both computers run this version. Before, a transfer file for a joined server had to be under 100 MB. The file goes in parts, so a short connection loss does not stop it, and a new try sends only the parts that the server does not have. The chat history can also move this way. The phone app keeps the 100 MB limit.

### Fixed

- A transfer with workspace files copied the files of chat messages from the Shared folder without their messages. These files now move only with the chat history.
- Moved chats and channels no longer show their old messages as unread. A moved agent shows its last message in the sidebar.
