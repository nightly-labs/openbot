### Fixed

- When an agent writes to shared data with fewer or more values than the statement needs, the agent
  now gets a clear message with both numbers and can correct the write. Before, a missing value was
  saved as empty, and a long multi-row write often failed with a "NOT NULL constraint failed" error
  that did not explain the cause.
