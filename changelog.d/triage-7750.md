### Fixed

- An agent no longer stops when an edit of its next queued message is not saved or cancelled. Before,
  all routines, webhooks and messages of that agent stayed "queued" until somebody deleted that
  message, also after a restart. Now an edit holds the message for 10 minutes at most. After that,
  the message runs with its original text. An edit that is open when OpenBot restarts gets 10 new
  minutes, so you can still save it. On a joined server, the server must also be on this version.
- When a queued message that you edit runs or is deleted before you save, the edit now ends by
  itself, in the agent's chat and in a thread. Your changes stay in the message box, and a note says
  what happened. Before, the app stayed in edit mode and Save showed "This edit has already
  finished.", or the changes were lost.
