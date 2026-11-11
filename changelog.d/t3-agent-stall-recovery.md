### Fixed

- A team no longer stops when the lead ends its turn with no answer after its teammates report back.
  The lead now reads the results again one time, or on its backup model when it has one. If it still
  gives no answer, the chat shows an error and you can send the message again.
- A ChatGPT agent that ends a turn with no answer now shows an error, as other agents do. Before, the
  turn ended with nothing in the chat.
