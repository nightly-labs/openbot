### Fixed

- A new API key that you save for a provider is used in your next message, also when the provider could not
  start again at once after the save. Before, the provider kept the previous key for up to 10 minutes, and each
  message failed with an error that said that your saved key was refused.
