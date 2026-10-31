### Added

- Start a workflow from GitHub. A GitHub trigger runs on new issues, comments, labels, pull requests,
  reviews, merges, closes, assignments, failed checks, or a mention of `@openbotgit`, in a repository
  that the OpenBot GitHub App can see. A second event for the same issue waits for the first run, and
  events for other issues run at the same time. The trigger shows the newest 50 events and why each
  one started a run, waited, or was skipped.
- Change GitHub from a workflow. A GitHub output comments, adds or removes labels, assigns a person,
  asks for a review, approves or requests changes, closes, reopens, or creates an issue, as the
  OpenBot GitHub App. An agent can choose the labels or the person from the repository's own lists.
- Show each open run on the workflow canvas, and the events that wait for one.
