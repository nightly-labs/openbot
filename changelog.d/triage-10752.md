### Fixed

- An agent step on the workflow canvas showed a model picker, but the run always used the model of
  the agent and ignored the model that you selected. The step now shows the model of its agent, which
  you change in the settings of that agent. To use a different model for one step, add an LLM step.
- An agent that edits a workflow can no longer give an agent step a model that a run does not use.
  OpenBot now tells the agent to add an LLM step for a different model. Before, the edit saved the
  model, and the run ignored it. For a workflow on a joined server, the server must also be on the
  new version.
