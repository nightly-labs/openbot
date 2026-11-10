### Fixed

- In the browser app (`openbot.run/app`), a joined server, such as an OpenBot server on a VPS, now
  shows the context meter with "Compact now" for agent chats and side threads, and "Delete history"
  for agent chats. Channels show "New conversation", "Compact context" and "Delete history". Before,
  only the desktop app showed these settings. The server must be on this version.
- In the desktop app, a joined server now has these features when its host supports them. Before,
  only this computer had them:
  - The "Files" filter of the search.
  - Custom ACP agents in Settings and in the agent form, for an owner or admin.
  - "Change key" for the server key, for the owner.
  - The place where the routines of an agent send their results, for an owner or admin.
  - Import of passwords from a CSV file into the server vault, for an owner or admin.
  - The memory limit in the agent settings, for an owner or admin.
  - "View" and "Undo" on an instructions change in the chat.
  - The provider account in the new agent form, for an owner or admin.
  - Messaging places, Telegram chats and Slack workspaces as workflow triggers and outputs, for an
    owner or admin.
- In the browser app (`openbot.run/app`), a joined server now has these features when its host
  supports them. Before, only the desktop app had them:
  - The "Files" filter of the search, and search results in side threads.
  - Custom ACP agents in Server Settings > Providers, for an owner or admin.
  - "Change key" for the server key, for the owner.
  - Import of passwords from a CSV file into the server vault, for an owner or admin.
  - The provider account in the new agent form, for an owner or admin.
  - Memories and the Routines row in the agent settings.
  - Folders, the instruction file, the routine results place and the memory limit in the agent
    settings, for an owner or admin.
  - The Files pane of an agent and of a chat.
  - "View" and "Undo" on an instructions change in the chat.
  - "Mark as unread", "Send now" on a queued message, "Send to channel", MCP sign-in from a chat card
    and the Usage link in the chat.
  - "Leave server" and "Remove server" in Server Settings > General.
  - The disk warning card in the sidebar, for an owner or admin.
- On a joined server, the message search now also finds messages in side threads. The server must be
  on this version.
- On a joined server, an owner or admin can now send a workflow output to an OpenBot channel. The
  server must be on this version.

- In the browser app (`openbot.run/app`), the sidebar now shows the unread count of an agent after
  "Mark as unread", and the unread dot of the server shows only when a chat has unread messages.

### Added

- On a joined server, the desktop app and the browser app now show the open waits of an agent above
  the composer, with "Cancel". The server must be on this version.
- On a joined server, "Run as a new thread" on a queued message now works in the desktop app and in
  the browser app. The server must be on this version.
- An owner or admin of a joined server now sees the programs that agents left running on the server,
  such as a dev server, in Server Settings > Storage, with "Stop". The command lines are redacted. The
  server must be on this version.
- The browser app (`openbot.run/app`) now shows the Workflows page for a joined server whose host has
  workflows.
- An owner or admin of a joined server can now turn the server's providers off and on in Server
  Settings > Providers, in the desktop app and in the browser app. The server must be on this version.
- On a joined server, the desktop app and the browser app now show, make and change routines that run
  once, for agents and channels. The server must be on this version.
- On a joined server, the desktop app and the browser app now show the picture of a channel, and a
  member who sees the channel can set an icon or an image, or remove it, as in the mobile app. The
  server must also be on this version.
- An owner or admin of a joined server can now copy the run command of a routine in the desktop app
  and in the browser app, when Local scripts is on for the agent. The command runs only in a shell on
  the server. The server must be on this version.
- An owner or admin of a joined server can now turn "Use my Claude Code setup" of the server on and
  off in Server Settings > Providers > Claude, in the desktop app and in the browser app. The server
  must be on this version.
- On a joined server, the queue of a side thread now shows each waiting message in full, with its
  actions: remove, send now and change the order. This works in the desktop app and in the browser
  app. The server must be on this version.
- On a joined server, the usage-limit card in the chat now asks where to send a message that a usage
  limit holds, in the desktop app and in the browser app, for a member who can manage the agent. The
  server must be on this version.
- An owner or admin of a joined server can now import the Hermes Agent profiles of the server's Hermes
  folder, in the desktop app and in the browser app. The server must be on this version.
- An owner or admin of a joined server now sees the local model servers and ACP agents that the server
  finds, with "Add", in Server Settings > Providers, in the desktop app and in the browser app. The
  server must be on this version.
- In the browser app (`openbot.run/app`), voice conversations can now use Codex live voice of a joined
  server whose host has it. Turn on "Codex live voice" in Settings. The voice goes from the browser to
  OpenAI. Dictation stays in the desktop app.
- An owner or admin of a joined server can now export and import the server in Server Settings >
  Transfer in the browser app (`openbot.run/app`).
- In the browser app (`openbot.run/app`), the skills of an agent now show their marketplace
  descriptions and icons.
- In the browser app (`openbot.run/app`), the search now has the "Routines" filter for a joined server.
- On a joined server, the Hermes import and the local model detection now say that they read the
  server, not this computer.
