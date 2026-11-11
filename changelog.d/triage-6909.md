### Fixed

- A scheduled, script or webhook routine run that answers only `[SILENT]` now stays quiet, as one that answers `[[no-update]]` does. Before, the chat showed the text "[SILENT]" and OpenBot sent a notification. Routines imported from Hermes Agent often use this word. A manual Test run still shows the answer.
