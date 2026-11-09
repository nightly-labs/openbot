### Fixed

- Show no "Mistral error" message when Mistral Vibe sends a request again after a dropped connection.
  Before, each retry line in its log showed as an error, also when the turn then completed. A turn
  that fails still shows its error in the chat.
