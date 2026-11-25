### Fixed

- A task in a channel no longer waits until you restart OpenBot when the agent's earlier turn in that channel, or in another channel, has ended but is still marked as running. OpenBot now ends that turn as interrupted, and the task starts. Before, the task stayed queued and the agent showed "working".
