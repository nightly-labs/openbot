/** Keeps an HTTP rejection distinct from a lost connection without exposing the response body. */
export class RemoteRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
