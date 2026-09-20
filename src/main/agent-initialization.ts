export class AgentInitializationGate {
  readonly #initialize: () => Promise<void>;
  #pending: Promise<void> | null = null;
  #settled = false;

  constructor(initialize: () => Promise<void>) {
    this.#initialize = initialize;
  }

  /** Whether the first initialization — including database migrations — is still running. */
  get pending(): boolean {
    return this.#pending !== null && !this.#settled;
  }

  start(): Promise<void> {
    if (!this.#pending) {
      this.#settled = false;
      this.#pending = this.#initialize().then(
        () => {
          this.#settled = true;
        },
        (error: unknown) => {
          this.#settled = true;
          this.#pending = null;
          throw error;
        },
      );
    }
    return this.#pending;
  }
}
