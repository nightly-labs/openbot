### Fixed

- With "Use my Claude Code setup" off, Claude agents no longer load your `~/.claude/CLAUDE.md` and the
  rules in `~/.claude/rules`. Before, they loaded these files on each turn as project files, also the
  files that you excluded with `claudeMdExcludes`, so each turn was slower and cost more. To keep these
  files, turn on "Use my Claude Code setup". Then your exclusions apply as in Claude Code. A joined
  server must also be on this version.
