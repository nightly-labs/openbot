### Fixed

- A Grok Bot export keeps every schedule of a task. Before, the export agent could merge a task that ran three times a day into fewer runs. A task that starts on an event, such as a webhook, no longer comes over as a routine that is off and has a placeholder schedule: the export agent tells you about it and saves its prompt in `imported/EVENT-TASKS.md`. Paths in the instructions now point to the files in `imported/`. Make a new export in Grok Bot to get these changes.
