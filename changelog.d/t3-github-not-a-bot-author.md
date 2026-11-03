### Fixed

- The "Author is not a bot" filter of a GitHub workflow trigger now also refuses OpenBot's own bot. It
  checks the author of the issue, pull request, comment or review, and the account that did the action.
  When one of them is a bot, the workflow does not start. For example, a person who merges a Dependabot
  pull request no longer starts a workflow with this filter. Turn off the filter to start on these events.
