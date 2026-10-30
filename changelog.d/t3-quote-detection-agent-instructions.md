### Added

- Agent settings have an Instructions editor for the agent's `AGENTS.md` file. The agent keeps its
  standing rules in this file, and changes the file when you ask it to change its instructions. A
  workspace that has only a `CLAUDE.md` file keeps that file. Each provider gets the file, also a
  provider that does not read it by itself.

### Changed

- The old Instructions field is now Description: a short summary that teammates read to choose who
  does a task.

### Fixed

- An agent with no title no longer saves "General assistant" as its title.
