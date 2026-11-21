### Added

- Workflow steps can give typed answers. On an agent step, a model step or a webhook trigger, open
  **Answer fields** in the step toolbar and write one field on each line, for example
  `priority: high|normal|low` or `count: number`. The step then gives these fields, and a model step
  or an agent gets one more try when its answer does not fit. A webhook request that does not fit
  gets a 400 answer and starts no run.
- A condition can test answer fields with **Check**, for example `priority = high and count > 2`.
  A check makes no model call, so it is fast and free.
- Write `{{name}}` in an agent task, a model prompt or an approval question to put the value of an
  answer field there. Text values come in quotes, and a name that no step before gives
  stays as it is. The step shows a warning when a name or a check does not match the steps before
  it. Agents that build workflows get the same warnings. To test a webhook workflow by hand, give
  the trigger's fields as the run input, for example `{"priority":"high"}`. On a joined server, the
  server must also be on the new version.

### Fixed

- After a workflow run, a condition step shows again which branch the run took. Before, both
  branches showed as skipped.
- While a condition has a check, the step hides its rule, model and effort, because the check does
  not use them. Clear the check to get them back.
