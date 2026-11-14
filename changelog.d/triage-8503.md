### Fixed

- In a thread, when a ChatGPT agent got a teammate's result and then ended its turn with no answer,
  the thread failed with "ChatGPT ended the turn with no answer". The agent now tries once more by
  itself, as it already did in its main chat. The thread shows the error only when the second try
  also gives no answer.
