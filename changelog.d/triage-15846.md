### Fixed

- A new server on this computer keeps its own Claude, Codex and Grok sign-ins. Before, all
  servers on one computer used the same sign-in, so a sign-in on one server changed the account of the
  others. Servers that you made before this version keep the shared sign-in. On a new server, "Use
  my Claude Code setup" does not load your setup from `~/.claude`.
