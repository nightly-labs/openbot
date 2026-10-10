### Changed

- A scheduled routine run can now end without a message when the agent calls the new
  `routine_no_update` tool. Before, the run stayed quiet only when the answer was exactly
  `[[no-update]]`, and an answer such as "Nothing new." sent a notification. The marker still
  works. A Test run still shows its answer.
