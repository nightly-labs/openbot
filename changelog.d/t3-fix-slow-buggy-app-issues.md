### Fixed

- A chat now shows a changed image, video, voice recording, UI block, memory change or turn trace.
  Before, the chat sometimes kept the old version until you opened it again.
- A long chat uses less CPU while an agent streams a reply. Before, each update searched the full
  chat and the full agent list.
- Members of a server get a finished reply with less delay. Before, the server did the same work
  again for each member.
- A remote screen or remote desktop view that gets a connection error now closes correctly.
  Before, OpenBot recorded the error as a crash of the app.
- The Computer Use highlight comes back after its window fails to load. Before, it stayed empty
  until the agent stopped using the screen for a minute.
- Two quick clicks on a sign-in of a joined server now start only one sign-in. Before, the host
  started two.
