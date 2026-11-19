### Fixed

- An agent step of a workflow now knows how the workflow run started: by hand, on a schedule, from a
  webhook, or from a GitHub, Discord, Telegram or Slack event. Before, the agent was always told that
  the run was scheduled, so a step that checks for a manual run failed.
