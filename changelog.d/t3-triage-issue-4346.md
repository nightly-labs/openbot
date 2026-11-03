### Fixed

- On Windows, delete an agent on the first try also after another provider stopped, after a Pi restart, or after OpenBot started. Before, the agent's Pi or other provider session could stay open in the agent folder, and the delete failed with "The agent data could not be removed completely" until you restarted OpenBot.
