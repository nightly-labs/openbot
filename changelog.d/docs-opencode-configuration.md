### Added

- Explain how to change the settings of the OpenCode that OpenBot runs. Put an `opencode.json` file
  in `~/OpenBot` to configure every agent workspace, or in `~/OpenBot/Agents/<agent-id>` to
  configure one agent. The file of one agent wins over the shared file, for example to start one
  agent with the plan agent while the others use the build agent.
