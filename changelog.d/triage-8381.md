### Fixed

- An agent on an Ollama model that cannot reason, such as `mistral:latest`, answers again when
  OpenCode runs the model. Before, each message failed with "does not support thinking", because
  OpenBot sent the agent's reasoning effort to the model. OpenBot now asks the Ollama server which
  of its models can reason, and offers no effort for the others. A model with efforts that you saved
  in its provider settings keeps them. `PRIVACY.md` describes the new requests. When the agent runs on a server, the server must also be on
  the new version.
