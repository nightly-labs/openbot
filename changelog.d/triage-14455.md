### Fixed

- A provider or account change that shows "After this turn" now takes effect when the running turns
  end. Before, while the agent's side chats were still running, the next queued message started on
  the old model, and the change could wait until you stopped all the agent's work. Now new messages
  wait until the running turns finish. Then the change takes effect, and the queued messages start on
  the new model. No running work is stopped. If you choose the old model again, the queued messages
  start at once. On a joined server, the server must also be on the new version.
