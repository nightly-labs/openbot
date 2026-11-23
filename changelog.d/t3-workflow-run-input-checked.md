### Fixed

- When an agent starts a workflow with input, OpenBot now checks the input against the answer fields of the trigger and refuses a start with wrong or missing fields. A start with no input works as before.
- A retried workflow step now checks its answer with the answer fields of its run, also when the workflow was changed after the run started.
- "Run one step" no longer uses an old answer of a step before it when that step failed or stopped the last time it ran. It asks you to run that step again first.
