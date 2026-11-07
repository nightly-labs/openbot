### Added

- Settings > Providers > Claude has a "Use my Claude Code setup" switch. It is off by default: the
  agents on this computer no longer load your own CLAUDE.md, skills, agents, hooks and plugins from
  `~/.claude`, so each turn sends a shorter prompt. The files of an agent's workspace still load.
  Turn the switch on to give the agents your Claude Code setup again.
- Channel settings have "New conversation" and "Compact context" for a channel on this computer.
  A new conversation makes the members forget the earlier messages, and their next turns send a
  much shorter prompt. The messages stay visible above a divider, and the members, instructions,
  memories and routines do not change. Compact now makes each member keep a short summary of its
  channel session. It works for members whose provider OpenBot can ask to compact, such as Codex
  and Pi. Claude members keep their own automatic compaction.
