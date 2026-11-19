### Fixed

- In a workflow with a loop that one more connection also enters, such as the task to a reviewer, the
  loop now goes back to its leftmost step on the canvas. Before, the order in which you added the steps
  and connections decided this. "Run from this step" inside the loop now uses the newest answers of the
  steps before it, and a full run no longer starts the reviewer before the search or repeats the loop
  without an end.
