### Fixed

- In a workflow with a loop that one more connection also enters, such as the task to a reviewer, the
  loop goes back to the step that its condition goes back to. "Run from this step" inside the loop
  now uses the newest answers of the steps before it, and a full run no longer starts the reviewer
  before the search.
