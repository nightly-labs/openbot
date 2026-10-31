### Changed

- Send about 3k fewer tokens in each Claude agent request. Claude agents no longer get the
  `Workflow` and `ListAgents` tools, which OpenBot does not show, and Claude auto memory is off:
  OpenBot memory is the agent's only memory. Earlier Claude memory files stay on disk.
- Send fewer tokens in each request of the other providers:
  - Pi loads the tools of your own MCP servers only when the agent searches for them. With computer
    use on, this removes about 24k tokens from each request.
  - Grok no longer gets its `send_feedback` and `workflow` tools.
  - Antigravity no longer gets its `schedule` and `run_workflow` tools. Use OpenBot routines.
  - Codex goals are off. OpenBot has no control to pause or stop a goal.
  - OpenCode no longer gets its tools that rename or move a session, or that make or list worktrees.
