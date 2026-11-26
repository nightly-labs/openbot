### Fixed

- A server with many agents and a large chat history responds faster when agents send and receive messages. Before, each new message made the next chat and queue update read the full message history again for each agent.
