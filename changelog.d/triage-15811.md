### Fixed

- OpenCode agents: when OpenCode did not load OpenBot's tools, the agent could work for minutes
  without them and the app did not tell you. Now the reply says that the agent ran without OpenBot's
  tools, and OpenBot gives the tools to OpenCode again before the next message.
- Local scripts that wake an agent no longer use the port of an earlier OpenBot run. Before, after
  a crash or a slow quit, the scripts used the old port until all providers had started.
