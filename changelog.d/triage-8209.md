### Fixed

- When a provider waits to update or restart until its running tasks end, the message queue of each agent on that provider now says so. Before, the queued messages waited with no reason, and the agents looked frozen.
- The message queue of the open chat updates again as soon as a message waits, starts or ends. In 0.73.0 it could show an old state until the chat read the queue again.
