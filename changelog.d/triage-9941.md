### Fixed

- An OpenCode agent whose model did not answer one request showed "OpenCode stopped responding" after 5 minutes, at the moment when OpenCode was about to try the request again. OpenBot now waits for that retry, so the turn continues when the model answers it. When the model does not answer the retry too, the turn ends with the same message.
