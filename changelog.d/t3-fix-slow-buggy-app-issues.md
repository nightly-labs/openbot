### Fixed

- A chat now shows a change to an image or video generation, a UI block, a voice recording, a memory
  change or a turn trace when nothing else in the message changed. Before, the chat kept the old value.
- Streamed replies use less CPU. Each save of a streamed message reads only its own agent, not all
  agents, and a long chat no longer searches every message for each reply quote or compaction marker.
- A server sends a finished turn to its members with less work, and handles event receipts faster.
- A remote screen or remote desktop viewer that drops or sends a bad frame no longer causes a
  main-process error. Only that stream ends.
- The Computer Use highlight comes back after its window fails to load. Before, it stayed empty
  until the agent stopped using the screen for a minute.
- Two quick clicks on a relayed sign-in of a joined server no longer start two sign-ins on the host.
