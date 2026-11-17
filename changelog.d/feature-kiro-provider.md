### Added

- Kiro is now a provider. OpenBot runs the Kiro CLI that you installed (`kiro-cli acp`), and agents on
  Kiro run their chat, tasks and channel turns at the same time. Connect on the Kiro row opens Kiro's
  sign-in page in your browser, and a joined server shows a code to confirm on any device. For IAM
  Identity Center, run `kiro-cli login` in a terminal first. The subagents that a Kiro agent starts show
  as cards in the chat, with their task, their steps and their state, and the context bar shows how full
  the session is. Kiro reads skills from `.kiro/skills` only, so OpenBot names your other skills in the
  agent's instructions and the agent reads them from there.
