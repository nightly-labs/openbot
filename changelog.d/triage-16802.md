### Fixed

- A custom provider that runs on Pi now uses its saved API key also when it has an extra `Authorization` header. Before, the extra header replaced the key, and the endpoint refused each chat message with "Missing or invalid Authorization header", but the same provider worked on OpenCode. A custom provider with no saved key keeps sending its own `Authorization` header.
