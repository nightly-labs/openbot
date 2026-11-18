### Fixed

- A custom provider that runs on Pi now works with services that accept only standard fields, such
  as Mistral. Before, each message failed with an error, because Pi sent OpenAI-only fields to every
  service that was not OpenAI.
