### Fixed

- A Gemini (Antigravity) routine run that calls `routine_no_update` when there is nothing to report
  no longer fails with `Model produced invalid output`. The tool now allows ending with
  `[[no-update]]` when a model requires text to finish a turn, and the Antigravity adapter
  recognizes CLI 1.5's empty-output warning on turns that need no reply.
