### Fixed

- When a provider account stopped offering an agent's model, the agent moved to its backup model, then went back to the old model about every 10 minutes and failed again. Now the agent stays on its backup model. It tries the old model again when you choose it for the agent, when you sign in to the account again, or after OpenBot restarts.
