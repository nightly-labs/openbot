### Added

- A GitHub trigger of a workflow can watch more than one repository. An event from any of them starts a
  run, and a GitHub output set to "Same as trigger" acts on the repository of that event. Workflows that
  watch one repository do not change.

### Fixed

- The line under the search field of a workflow menu no longer shows in the focus colour each time the
  menu opens.
- A long label or repository name ends with "…" in its tag on a workflow card. Before, it went past the
  edge of the card.
