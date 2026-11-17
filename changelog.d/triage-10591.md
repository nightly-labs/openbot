### Fixed

- A custom endpoint for Mistral's API (`https://api.mistral.ai`) with an API key now answers when the
  reasoning effort is high enough that Mistral streams its thinking, such as "max". Before, each such
  message failed with "The model's reply was cut off or was not valid". For an agent on a joined
  server, the server must also be on the new version.
