### Fixed

- When a Workspace only custom agent fails because the macOS sandbox blocks a write, for example to its own database in the home folder, the error now says "Workspace only blocks this. Try Full access." Before, only the agent's own error showed, with no cause.
