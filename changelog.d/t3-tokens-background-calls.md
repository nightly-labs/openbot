### Changed

- Memory reviews, channel summaries and profile drafts now run at the lowest reasoning effort that
  the model takes, on each provider whose model has effort levels. The effort of the agent's own
  turns does not change.
- On Claude, model calls without tools no longer send the Claude Code coding instructions. This
  includes memory reviews, channel summaries, profile drafts, side questions, workflow model steps
  and channel routing. Each call sends about 2,300 fewer input tokens, and spends less of the Claude
  plan.
