### Fixed

- A message with many large photos now reaches OpenCode and other ACP agents. Before, a batch such
  as 10 photos of 5 MB stopped the agent, and the chat showed only "ACP connection closed". Now
  OpenBot makes large photos smaller before it sends them, and when a message has more photos than
  the agent can take at once, the agent gets the other photos as files that it can open.
