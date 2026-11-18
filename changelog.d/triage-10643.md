### Fixed

- The context meter of a GitHub Copilot agent said "This agent does not compact its context.",
  although GitHub Copilot compacts the chat by itself. Now it says "The provider manages automatic
  compaction.", and it does not show a full context as a warning. For an agent on a joined server,
  the server must also be on the new version.
