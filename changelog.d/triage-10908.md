### Fixed

- Show no stack of error notifications when a custom agent writes an error report. Before, each line
  of the report was a separate "Custom agent error" notification, such as
  `raise HTTPError(req.full_url, code, msg, hdrs, fp)`. These lines now go to the diagnostics log. A
  failed request, a failed turn and a stopped agent still show their error.
