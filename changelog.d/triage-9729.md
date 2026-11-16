### Fixed

- When the provider process of an agent stops in the middle of an answer, the agent now continues one
  time and gives the complete answer. The chat shows "The agent stopped before it finished its answer.
  The agent continues." before the new answer. When the answer stops again, or another message waits,
  the chat says that the answer is not complete, and that you can send the message again. Before, the
  chat showed the first words of the answer, such as "O" or "Minha", as a complete answer, with no
  error (#9729). A joined server needs this version too.
