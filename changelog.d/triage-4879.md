### Fixed

- A workflow Condition step, and an LLM step with no model, now use a connected provider when you did
  not choose a default provider and ChatGPT is not connected. Before, the step failed with "Connect
  ChatGPT to continue". A default provider that you chose stays the provider of these steps.
