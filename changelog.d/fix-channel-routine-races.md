### Fixed

- Deleting a routine now also removes the work it queued and nobody started yet, in agent chats and in channels. Before, that work could still run after the routine was gone. Channel work that already started keeps running and can be stopped as usual. Deleting an agent routine still stops its active turn.
- Files attached to a channel message are no longer lost when the channel is archived while the message is being sent. You can send them again.
- Stopping or reassigning a channel task while it was being handed to a member no longer gets undone when that hand-off fails.
