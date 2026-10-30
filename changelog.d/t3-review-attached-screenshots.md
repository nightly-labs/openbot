### Fixed

- In a channel, a turn that the provider starts by itself, as when a Claude or ACP background job ends, no longer takes the member's next task. Before, that turn ran as the next task, its text showed as the task's reply, the task's own request did not start, and the channel showed "The provider could not start this assignment."
