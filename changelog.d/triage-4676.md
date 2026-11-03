### Fixed

- On a server that is low on memory, OpenBot now closes the idle provider sessions at once when a message waits in the queue, so the message can start sooner. Before, the message could wait up to 10 minutes for these sessions to close, also when no agent was working.
