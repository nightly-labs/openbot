### Fixed

- On a server, ChatGPT agents on GPT-6 and other code-mode models can run commands and tools again
  when the Codex installed on the server is only the `codex` program without its helper files.
  Before, each command failed with "failed to spawn code-mode host", and the only fix was Download
  in Settings > Providers. The server now downloads OpenBot's complete Codex once, by itself, unless
  you chose "Use installed version". On a joined server, the server must also be on this version.
  (#15586)
