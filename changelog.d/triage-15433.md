### Fixed

- A ChatGPT (Codex) agent no longer tries Codex's own Chrome and browser plugins, which cannot work in
  OpenBot. Before, the agent stopped with "The browser access host is unavailable". Now it uses the
  OpenBot browser, or your Chrome tabs that you share with the OpenBot extension. On a joined server,
  the server must also be on this version.
