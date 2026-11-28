### Fixed

- When Mistral Vibe stops a task because its usage budget is used up, the work that Mistral started now continues on the first available backup model. Before, the task stopped. Other Mistral payment errors still stop the task after work has started.
