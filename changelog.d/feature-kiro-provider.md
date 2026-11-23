### Added

- Kiro is now a provider. OpenBot runs the Kiro CLI that you installed on its V3 engine (`kiro-cli acp
  --agent-engine=v3`), so it needs Kiro CLI 2.36 or newer, and agents on Kiro run their chat, tasks and
  channel turns at the same time. Connect on the Kiro row opens Kiro's sign-in page in your browser, and a
  joined server shows a code to confirm on any device. For IAM Identity Center, run `kiro-cli login` in a
  terminal first. The context bar shows how full the session is. The subagents that a Kiro agent starts
  show as tool cards, not as subagent cards. Kiro reads skills from `.kiro/skills` only, so OpenBot names
  your other skills in the agent's instructions and the agent reads them from there.
