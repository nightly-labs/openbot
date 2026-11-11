### Fixed

- The Usage popup now shows current plan limits for Claude, Codex and Grok also when no agent used
  them for a while. Before, after OpenBot stopped an idle provider, the popup kept its last reading
  until a limit window reset, sometimes for days, so use outside OpenBot (for example in a terminal)
  did not show. On a joined server, the server must also be on the new version.
