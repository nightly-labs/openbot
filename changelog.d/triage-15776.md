### Fixed

- A message that you send to a Claude agent while it waits for a browser sign-in, password or code card
  no longer cancels the card. The card stays open, and the agent reads your message after you answer
  it. Before, the card closed as cancelled and the agent got an "interrupted" error. The server must
  also be on this version.
