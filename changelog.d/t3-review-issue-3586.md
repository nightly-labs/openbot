### Fixed

- An agent that starts a task each routine run no longer stops at 8 open tasks. Only tasks that run or have a queued message count toward the limit. When the agent starts a task, OpenBot archives its finished tasks other than the newest 8. Tasks that you started stay open.
