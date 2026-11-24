### Fixed

- When OpenBot updates a provider CLI, such as the Claude CLI, other agents on that provider keep
  starting new turns and routine runs. Before, one long turn of one agent held the messages and
  routines of all agents on that provider until the turn ended or the app restarted. The update now
  runs at the first moment when no turn runs. While it waits, OpenBot no longer ends open questions
  early: an agent keeps waiting for your answer. A joined server must also be on the new version.
