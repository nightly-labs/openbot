### Fixed

- A Claude agent that moves to a backup Claude model after a provider error, such as a network failure, now answers the message on the backup model. Before, the agent stayed "working" with no answer, and the messages behind it did not start until a Stop or a restart.
