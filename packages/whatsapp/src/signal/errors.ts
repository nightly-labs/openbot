// Errors that callers recognize by their message text.

/**
 * A message key was used already or was never kept. The text is the one that Baileys compares with
 * `MISSING_KEYS_ERROR_TEXT`: it then rejects the message and does not ask for a retry.
 */
export class MessageCounterError extends Error {
  constructor() {
    super("Key used already or never filled");
    this.name = "MessageCounterError";
  }
}

/** No session exists for the address. Baileys finds "No session record" in the text. */
export class NoSessionError extends Error {
  constructor(address: string) {
    super(`No session record for ${address}`);
    this.name = "SessionError";
  }
}
