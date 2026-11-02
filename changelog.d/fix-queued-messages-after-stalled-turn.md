### Fixed

- Messages sent while an agent's turn stalled run as their own turn after the stalled turn fails.
  Before, they waited in the queue, joined the stalled turn, and were then dropped with it — no run
  read them, no reply came, and no error named them, until OpenBot restarted (#4326). Each message
  now returns to the queue once; if the next turn fails the same way, the message ends as failed.
