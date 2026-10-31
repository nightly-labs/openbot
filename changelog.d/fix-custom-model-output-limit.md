### Fixed

- A custom OpenAI-compatible model with an output limit below 32,000 tokens can run a turn again. OpenCode 2.2.5 read OpenBot's `output: 0` marker as unknown and asked the endpoint for a fixed 32,000 output tokens, which a model with a smaller limit, such as one with a 16K-token window, refused before the first token. The model now gets an output budget of half its context window, no more than 32,000.
