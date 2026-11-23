### Added

- Workflows: a new `openbot.workflow` file format holds one workflow with its asset files. Agents and channels go in by name, connections and media accounts are left out, and a schedule keeps its timezone. A file with a secret in a step is refused. A file from a newer OpenBot is refused with "update required" and the names of the steps that this version does not know. Export and import come in a later change.
