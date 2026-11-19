### Fixed

- A routine on a ChatGPT (Codex) agent now waits and tries again (after 5, 15 and 30 minutes) when
  Codex does not open its new chat in time. Before, the run failed at once with "Codex request timed
  out: thread/start", and the routine missed that run. After the last try, the run says to restart the
  provider on the Providers page. On a joined server, the server must also be on this version.
