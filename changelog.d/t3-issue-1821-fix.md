### Fixed

- Claude agents keep their prompt cache when their saved memories change. Before, each memory
  change, such as a new memory that the agent saved, made the next turn write the whole
  conversation to the cache again. The agent now gets the change with its next message.
