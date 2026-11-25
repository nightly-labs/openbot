### Fixed

- A confirm card now stays open, and you get it one time, when the agent's provider stops each tool
  call after a fixed time, such as Mistral Vibe or Cursor. Before, the agent got an error after 60
  seconds, the card closed with "No answer was given in time", and the agent asked the same question
  again, also on each run of a routine in the agent's chat. Now the agent waits for your answer, and
  your answer reaches it as a new message.
