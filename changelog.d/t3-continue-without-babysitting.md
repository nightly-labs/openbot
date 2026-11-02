### Changed

- An agent now needs less supervision to finish a request. When its plan still has open steps, it can
  continue by itself up to 8 times, not 3. When an answer only asks "Shall I continue?", the agent
  continues and does not wait for you. When a turn has no plan and ends on a step that the agent
  named but did not do, such as "I'll now run the tests.", the agent continues up to 2 times. A
  question about a named action, such as "Should I proceed with the deploy?", still waits for your
  answer.
