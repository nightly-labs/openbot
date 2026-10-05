### Fixed

- The files of an "Update from" message now sit at the left edge, under the update, where an
  agent's own files sit. Before, they were pushed to the right.
- A chat row no longer takes the data of the next message when messages in the middle of the chat
  change order. Before, a row could hold the raw text that an agent sent, or the file of another
  message, until the list updated.
- A chat message that cannot be shown now shows "This message could not be shown". The rest of the
  chat stays usable.
