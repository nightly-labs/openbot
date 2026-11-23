### Fixed

- When the model of a GitHub Copilot agent fails, the turn now ends as failed with a clear message.
  A routine run that fails this way now shows as failed. While GitHub Copilot tries again, the chat
  shows its progress. Before, Copilot's own "Info: … Retrying..." and "Error: …" lines showed as the
  agent's reply, and the run showed as succeeded.
