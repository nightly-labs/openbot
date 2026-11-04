### Added

- Agents can make, change, delete and run workflows. An agent can add, change, move, connect and
  remove steps on the canvas, start a run and read its result. The tools load only when an agent
  searches for them, so other turns do not get longer. Only your own
  message to an agent, in its chat or in a thread you opened, can make it change, delete or run a
  workflow; a routine run or a team member's message cannot. Before an agent deletes a workflow, OpenBot asks you
  to approve, also when the agent has Full access.
- When an agent builds or changes a workflow that is open on the Workflows page, you see its cursor
  go to each step, and the steps and connections show one after the other. A workflow that an agent
  makes while the page is open opens on its own.
- A workflow that an agent builds has a clean layout: the steps do not touch, each connection shows,
  and a condition's "No" step is below its "Yes" step. Ask an agent to tidy a workflow to lay it out again.

### Fixed

- An agent can now create or change a channel when you ask in a thread you opened, not only in its
  main chat.
- Claude agents use fewer steps and tokens with the tools they find with a search. They no longer
  call a found tool directly and get a refusal, and a request for a workflow no longer loads Claude
  Code's own workflow skill.
