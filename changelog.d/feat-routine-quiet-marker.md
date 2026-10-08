### Added

- Let a scheduled run of an agent routine stay silent when it has nothing to report. Ask the agent in
  the routine task to answer `[[no-update]]` in that case. When every answer of the run is only
  `[[no-update]]`, the run posts no message, adds no unread message, does not change the chat
  preview and shows no notification. The run marker stays in the chat, and the run stays in the
  routine **History**. Test runs, and script or webhook runs, always show their result.
  The browser client, the phone, and a desktop connected to a remote server stay silent for a
  quiet run too. An older client shows the run as finished, as before.
