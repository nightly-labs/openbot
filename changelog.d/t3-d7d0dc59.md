### Fixed

- The "Author is not a bot" filter of a GitHub workflow trigger now also refuses OpenBot's own bot. It
  checks the author of the issue, pull request, comment or review, not the person who did the action.
  A person who adds a label to a Dependabot pull request no longer starts the workflow.
