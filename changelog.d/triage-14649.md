### Fixed

- When a Claude account reaches its Fable limit, the agent now waits until the limit resets, or moves to its next backup model or account. Before, OpenBot took the limit message for a spent credit balance: the turn failed, and the next message tried the same account again. This also applies to the Opus and other Claude limits when their message offers usage credits. For an agent on a joined server, the server must also be on the new version.
