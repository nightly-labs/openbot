### Fixed

- A short drop in the connection to a joined server no longer adds "Could not mark the conversation as
  read" with "The WebRTC host disconnected." to the open chat. The app marks the chat read again, and
  loads its waiting list again, after it connects again. When an action that you started fails
  because the connection dropped, the chat now says in plain words that the connection was lost and
  that you can check the action and try again.
