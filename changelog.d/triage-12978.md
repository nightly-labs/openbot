### Fixed

- When an agent starts a new ChatGPT (Codex) session, OpenBot archives the old one. Before, if the
  ChatGPT or Codex app had the old conversation open, the archive failed, and the old conversation
  stayed in the Codex list of that app with the same agent name. Now OpenBot archives it again after
  that app closes it. If you continued that conversation in the ChatGPT or Codex app, OpenBot keeps it.
