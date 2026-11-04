### Fixed

- A workflow Condition step now runs on a connected provider when ChatGPT is not connected and your
  default is ChatGPT with no model chosen. Before, the step failed with "Connect ChatGPT to
  continue". Another default provider, or a default model that you chose, stays the provider of the
  step.
