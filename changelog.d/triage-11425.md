### Fixed

- A channel task no longer stops when ChatGPT ends a turn with no answer and does nothing. The task
  now runs once more by itself and continues. Before, it stopped at once, and the card told you to
  send the message again or start a new chat, which could start the same work two times. When the
  second try also gives no answer, the card now tells you to click Continue or Reassign. On a joined
  server, the server must also be on this version.
