### Added

- On the workflow canvas, the step menu has **Run from this step**. It starts a new run at that step
  and uses the answers of the steps before it, so their work does not run again. Before, you could
  start again in the same way only from a trigger, and a step that ended as done had no Retry. This
  works on a joined server and in the web client too.
