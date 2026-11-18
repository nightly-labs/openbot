### Fixed

- When a new thread did not start because the answer from the server got lost, a second try no longer
  makes a second thread with the same first message. The agent does the work one time. A server that
  is not on this version still makes the second thread.
