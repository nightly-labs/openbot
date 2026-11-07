### Fixed

- A DeepSeek model on a custom Mistral endpoint (`https://api.mistral.ai/v1`) no longer fails with HTTP 422 `extra_forbidden` from the second turn. OpenCode sent an empty `reasoning_content` on each earlier assistant message because the model id contains `deepseek`, and Mistral refuses that field.
