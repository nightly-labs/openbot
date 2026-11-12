### Fixed

- Switch a Claude agent to its backup model when Claude refuses the subscription for a billing
  problem, such as a payment that is past due. Before, the agent stopped with the error and did not
  try the backup model, also when automatic switching was on.
