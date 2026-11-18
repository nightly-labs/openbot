### Fixed

- An agent now continues with its teammates' results after OpenBot or a provider stops unexpectedly
  while the agent works with them, before the agent starts its answer. Before, the results showed "Interrupted" in the chat, and the agent
  stopped until you sent it a message. Now each result goes back to the queue one time, and the agent
  continues with it. The agent first checks what it already did, so that it does not do an action
  two times.
