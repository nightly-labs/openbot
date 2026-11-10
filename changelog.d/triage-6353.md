### Fixed

- Shared tables stay available after a write that ran too long. Before, the stopped write could make the table list empty, and each read or new table failed with "attempt to write a readonly database" until the agent changed a row.
