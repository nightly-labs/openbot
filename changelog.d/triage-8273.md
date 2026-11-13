### Fixed

- When many Pi agents started at the same time on a busy computer, a message could fail with "Pi request timed out: switch_session" before the agent started its turn, and you had to send it again. OpenBot now gives a new Pi process more time to start.
