### Fixed

- Claude agents: when the Claude Code settings or the environment variables send Claude requests to
  a different service, and that service refuses a request because of its account balance, the error
  now names that service and says that your Claude plan is not the cause. Before, the chat showed
  only the service's error text under Claude, such as "API Error: 402 Insufficient balance".
