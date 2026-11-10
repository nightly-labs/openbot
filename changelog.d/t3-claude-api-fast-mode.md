### Added

- Turn on Fast mode for a Claude agent from the model picker, as for Codex, when its model supports
  it, such as Claude Opus 5.5. Claude gives faster answers at a higher price. Fast mode works when
  Claude uses an Anthropic API key, or a Claude subscription with usage credits. Before it turns on,
  OpenBot asks you to confirm the price: a subscription pays for fast mode from usage credits, also
  when the plan has usage left. When Claude answers at the standard speed, the chat tells you why.
  Members of a joined server do not see Fast mode for Claude, because their apps do not ask to confirm.

### Changed

- A provider change turns off Fast mode for the agent. The first start of this version turns off
  Fast mode one time for each Claude agent, because an earlier version did not send it to Claude.
  When an agent goes back from a backup model, Fast mode comes back on if it was on before.
