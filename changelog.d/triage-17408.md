### Fixed

- An agent that ends a turn without a tool call, and says that it did not do the work yet or that it will do it now, now continues the request by itself more often. Before, a request ended as done with no message when the answer was longer than 400 characters, when a sentence followed the promise, when the next steps were a list, or when the agent only said that the work was not done. OpenBot now checks these answers, and the agent continues when work is missing. A joined server gets this change when it runs this version.
