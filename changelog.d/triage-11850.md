### Fixed

- A custom provider on Mistral's API that runs on Pi now replies. Before, each message failed with
  error 422, because Mistral refused the OpenAI-only fields that Pi sent.
- A custom provider that runs on Pi no longer sends OpenAI-only fields to services that refuse
  them. Before, some services refused each message with error 400 or 422.
