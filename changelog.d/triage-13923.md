### Fixed

- A Claude agent with full access gets its Instructions (the workspace `AGENTS.md`) once. Before, Claude
  Code also read the file, so each turn sent the Instructions twice and used more of the plan limit.
