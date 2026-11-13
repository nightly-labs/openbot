### Security

- Say in the Vault that every agent can read the API key files of the other agents, because all
  agents run as the same system user. The choice of agents for a key, and "Only this agent", control
  which agents OpenBot gives the key to. Before, the Vault said that agents read API keys from a
  private file, which was not true.
