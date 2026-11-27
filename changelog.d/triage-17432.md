### Fixed

- When a usage limit stops a channel task after the agent did some work, and no backup model is ready, the task now keeps its work and waits for the limit. When the limit ends, the agent continues the task by itself, as it does in a direct chat. Before, the task stopped and the channel showed Continue and Reassign, and the work waited until you clicked. On a joined server, the server must also be on the new version.
