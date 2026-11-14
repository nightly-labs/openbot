### Fixed

- When OpenCode cannot read the reasoning of a model at a high effort, the chat now tells you to
  select a lower effort or another model. Before, the chat showed only "Internal error: reasoning
  start before end". This occurred with some Vercel AI Gateway models in turns with more than one
  tool step.
