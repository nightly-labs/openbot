### Added

- Agent settings have an Instructions page that shows the agent's `AGENTS.md` file as formatted
  text, with the file name and its folder at the top. Edit opens the whole file on the page, and
  Show in Finder shows the file. The agent keeps its standing rules in this file, as short
  bullets under headings, and changes the file when you ask it to change its instructions. A
  workspace that has only a `CLAUDE.md` file keeps that file. Each provider gets the file, also a
  provider that does not read it by itself.
- When the agent changes its instructions, the chat shows "Updated its instructions" after its
  answer. View opens the instructions, and Undo puts back the text from before the change.

### Changed

- The old Instructions field is now Description: a short summary that teammates read to choose who
  does a task.

### Fixed

- An agent with no title no longer saves "General assistant" as its title.
