### Fixed

- With many side threads and a long message history, the app and joined clients no longer slow down by
  seconds while several side threads run. Before, each tool step of a side thread built the whole
  task list again and read the full message history for each task.
