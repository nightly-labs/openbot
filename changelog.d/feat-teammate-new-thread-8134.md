### Added

- An agent can send independent teammate work into a new thread: `send_message` takes `newThread`,
  each recipient gets a side thread of its own, the work does not wait in the recipient's busy chat,
  the result comes back to the sender, and a later reply continues that thread.
