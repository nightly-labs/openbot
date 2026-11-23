### Fixed

- A workflow loop runs each step one time per round. Before, when a loop went back to an earlier step, a step that read that earlier step and also a later one could run too soon with the old answer of the later step, and then run again. This could give two results for the same round, start an extra round, or run the last step two times.
