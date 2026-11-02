### Fixed

- Messages that wait in an agent's queue now stay in the queue when its provider must be signed in again, and they start after the sign-in. Before, a provider check that found the provider signed out during a turn marked those messages as failed, and they were never sent (#4326).
