### Fixed

- Agents continue their work again while a background job runs. Before, a Claude agent with a
  long background job, such as a dev server, stopped after each turn until you sent a message.
- Agents continue their work again while a teammate works on an older request. Before, the agent
  stopped after each turn until the teammate answered.
