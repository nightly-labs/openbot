### Changed

- When product analytics is on, OpenBot now records each webhook request that reaches your computer: the kind of owner (agent, channel or workflow), the result, the HTTP status, the body size and the answer time, at most 60 each minute. It never records the URL, the secret, the event type or the body. Routine run events now also tell a run that a webhook started.
