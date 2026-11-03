### Fixed

- On Windows, delete an agent on the first try also after a provider process restarted or after OpenBot started. Before, a Pi or other provider process could still use the agent folder, and the delete failed with "The agent data could not be removed completely" until you restarted OpenBot.
