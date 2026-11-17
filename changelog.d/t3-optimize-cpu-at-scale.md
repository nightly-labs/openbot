### Fixed

- OpenBot uses much less CPU while many agents work at the same time. Before, with many agents, the
  app could use a full processor core and the window could stop responding. Streamed replies, channel
  messages, the agent list, the sidebar and the Computer Use rim now do less work for each change.
- Channel transcripts update at most four times a second while agents write in them, and the unread
  counts on the web client and the phone app update at most once a second while events arrive. Before,
  each streamed piece of text read the channel and the unread counts again.
