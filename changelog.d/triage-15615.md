### Fixed

- Messages to Gemini agents no longer stay in the queue with "Waiting - Gemini restarts when its running tasks
  end" when one agent shows "working" but Gemini no longer runs its turn. Before, the restart waited for that
  turn forever, and the messages of all Gemini agents waited with it. Now OpenBot ends that turn as stopped,
  Gemini restarts, and the queued messages start. A turn that Gemini still runs keeps working, and the restart
  waits for it as before. This also applies to other agents that use the same connection, such as Cursor, Grok
  and OpenCode. When the agents run on a joined server, the server must also be on this version.
