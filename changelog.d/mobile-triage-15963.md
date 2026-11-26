### Fixed

- An OpenCode agent no longer refuses a message with "OpenCode does not offer … now" right after OpenCode starts, when OpenCode still loads its full model list. OpenBot now sends the agent's model and lets OpenCode check it. The message fails with this text only when OpenCode really does not offer the model. On a joined server, the server must also be on this version.
