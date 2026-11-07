### Changed

- Memory reviews, channel summaries and profile drafts on Claude and Codex now run at the lowest
  reasoning effort that the model takes. The effort of the agent's own turns does not change.
- On Claude, these calls without tools no longer send the Claude Code coding instructions. Each call
  sends about 2,300 fewer input tokens, and spends less of the Claude plan.
