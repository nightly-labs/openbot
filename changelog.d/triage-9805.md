### Fixed

- Keep the OpenBot tools of a Mistral agent in its own chat. With two Mistral agents, a confirmation
  card or another tool request of one agent could show in the chat of the other agent, and a "Not
  now" there went back to the first agent as its answer (#9805).
