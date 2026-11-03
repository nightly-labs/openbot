### Changed

- Each routine of an agent now runs in its own thread. A routine no longer waits for other routines or
  for the agent's chat, and the chat does not wait for a routine. The answer of a run shows in the
  routine's thread, and the chat shows the run with an "Open thread" link. A Test run opens the
  routine's thread. Before, all routine runs waited in one queue in the agent's chat.
- An agent with no thread limit of its own now runs up to 4 threads at the same time. Before, the
  default was 2.
