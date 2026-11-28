### Fixed

- An agent with backup models now goes back to its own model when a provider names a weekly or other
  usage limit as a used-up "balance", for example Grok's "usage balance exhausted". Before, OpenBot
  treated it as an empty credit balance, said "has no credits left … add credits", and kept the agent
  on the backup after the limit reset. Now OpenBot checks the provider's usage: when it shows a full
  limit with a reset time, the chat says "Usage limit reached", and the agent goes back at the reset.
