### Fixed

- A custom provider that runs on OpenCode, with the address `https://api.openai.com/v1` and an API
  key, now works with newer OpenAI models, such as GPT-6 Astra, when a reasoning effort is set.
  Before, each chat stopped with the error "Function tools with reasoning_effort are not supported".
  On a joined server, the server must also be on this version.
