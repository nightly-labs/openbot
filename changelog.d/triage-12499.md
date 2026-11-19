### Fixed

- With Pool accounts on, an agent moves to the next account of the pool when Google has no capacity
  for its Gemini model ("No capacity available", error 503). Before, the agent stayed on the same
  account, and each message failed. When each account fails, the agent moves to its backup model, or
  the chat shows the error as before.
