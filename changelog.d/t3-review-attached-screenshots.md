### Fixed

- In a channel, a turn that Claude or OpenCode starts after a background job ends no longer takes the member's next task. Before, that turn ran as the next task, the task's own request did not start, and the channel showed "The provider could not start this assignment."
