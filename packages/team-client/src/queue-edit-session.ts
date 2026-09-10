import type { QueueEditInput, QueueEditState } from "@openbot/contracts/ipc";

type Content = { text: string; attachmentDraftIds: string[] };
/** Serializes one editor's writes. An uncertain response is retried before a later write. */
export class QueueEditSession {
  #state: QueueEditState | null;
  #tail: Promise<void> = Promise.resolve();
  #pending: QueueEditInput | undefined;
  #saveGeneration = 0;
  constructor(
    readonly agentId: string,
    state: QueueEditState,
    readonly request: (input: QueueEditInput) => Promise<QueueEditState | null>,
  ) {
    this.#state = state;
  }

  get state() {
    return this.#state;
  }

  save(content: Content): Promise<void> {
    return this.#run("save", content, ++this.#saveGeneration);
  }
  send(content: Content): Promise<void> {
    return this.#run("save", content).then(() => this.#run("send", content));
  }
  cancel(): Promise<void> {
    return this.#run("cancel");
  }

  #run(operation: "save" | "send" | "cancel", content?: Content, saveGeneration?: number): Promise<void> {
    const work = this.#tail.then(async () => {
      if (saveGeneration !== undefined && saveGeneration !== this.#saveGeneration) return;
      if (this.#pending) await this.#flush();
      const state = this.#state;
      if (!state) return;
      const target = { agentId: this.agentId, deliveryId: state.deliveryId, revision: state.revision };
      if (operation === "cancel") this.#pending = { ...target, operation };
      else {
        if (!content) throw new Error("Queue edit content is required.");
        if (
          operation === "save" &&
          content.text === state.text &&
          JSON.stringify(content.attachmentDraftIds) === JSON.stringify(state.attachments.map((file) => file.id))
        )
          return;
        this.#pending = { ...target, operation, ...content };
      }
      await this.#flush();
    });
    this.#tail = work.catch(() => {});
    return work;
  }

  async #flush() {
    if (!this.#pending) return;
    this.#state = await this.request(this.#pending);
    this.#pending = undefined;
  }
}
