### Fixed

- A message to a Gemini agent after an idle time now waits up to 3 minutes for Gemini to start, and longer after an earlier slow start. This also applies to an agent set to "Workspace only" or to its own account. Before, on a slow or busy computer, mostly on Windows, the message often failed after 30 s with "Gemini did not answer in time", and OpenBot did not send it again.
