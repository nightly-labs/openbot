### Fixed

- A channel message that cannot be sent now tells you why. When OpenBot is not connected, it says
  to check your connection. When the channel is archived, it says to restore the channel first. When
  the server took the message but OpenBot could not confirm it, it says to check the chat before you
  send it again, and it does not offer to send it a second time. Before, each of these showed only
  "Not sent · The channel action failed."
