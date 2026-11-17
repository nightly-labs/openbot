### Fixed

- Stop a ChatGPT (Codex) agent whose command does not end. Before, when a command hung, for example
  on Windows with PowerShell 7 from the Microsoft Store, Stop showed "Could not stop the agent" and
  the chat stayed busy until OpenBot restarted. Now the turn stops after 10 seconds, and the next
  message runs. On a joined server, the server must also be on this version.
