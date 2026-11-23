### Fixed

- A workflow step that uses an answer field now fails with a clear error when the step that gives the field failed or was stopped, instead of running with an empty value. When a step before it gives answer fields, a `{{name}}` that none of them gives also fails the step. A check on a missing value is now false, also for `!=`.
