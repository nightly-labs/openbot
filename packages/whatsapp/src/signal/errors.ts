export class MessageCounterError extends Error {
  constructor() {
    super("Key used already or never filled");
    this.name = "MessageCounterError";
  }
}

export class NoSessionError extends Error {
  constructor(address: string) {
    super(`No session record for ${address}`);
    this.name = "SessionError";
  }
}
