### Fixed

- The browser preview no longer waits behind the agent's browser actions. While the agent works on a
  tab, or when a capture is slow, the preview shows the last frame of the same page. Before, a
  preview on a heavy web app could take up to 30 seconds, and it also delayed the agent's next
  action.
- Browser snapshots are smaller. The page text is limited to 20,000 characters, with the text in
  the viewport first, and the snapshot says when it left text or elements out. Each snapshot also
  shows fewer and shorter console and action entries. Before, each browser action could add up to
  1 MB of page text and log entries to the agent's context.
