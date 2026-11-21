### Fixed

- When the model settings of a provider change, other agents on that provider keep starting new
  turns. Before, OpenBot held the new turns of all agents on that provider until the longest running
  turn ended, which could take hours. The provider now restarts with the new settings when no turn
  runs.
