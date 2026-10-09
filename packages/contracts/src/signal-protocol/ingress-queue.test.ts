import { describe, expect, it } from "vitest";
import {
  createIngressQueueKeyPair,
  importIngressQueuePrivateKey,
  openQueuedDelivery,
  type QueuedSignalMessage,
  sealQueuedDelivery,
} from "./ingress-queue";

const message: QueuedSignalMessage = {
  type: "telegram-delivery",
  version: 1,
  botId: "123456",
  chatId: "-100200",
  bodyBase64: Buffer.from('{"message":{"text":"secret text"}}').toString("base64"),
};

// Signal keeps the message text of a sleeping host. Only that host may read it.
describe("ingress queue seal", () => {
  it("opens only with the host's stored key and the host ID it was sealed for", async () => {
    const host = await createIngressQueueKeyPair();
    const other = await createIngressQueueKeyPair();
    const sealed = await sealQueuedDelivery(host.publicKey, "host-1", message);

    expect(Buffer.from(sealed, "base64url").toString()).not.toContain("secret");
    const key = await importIngressQueuePrivateKey(host.privateKey);
    await expect(openQueuedDelivery(key, "host-1", sealed)).resolves.toEqual(message);
    await expect(openQueuedDelivery(key, "host-2", sealed)).rejects.toThrow();
    await expect(
      openQueuedDelivery(await importIngressQueuePrivateKey(other.privateKey), "host-1", sealed),
    ).rejects.toThrow();
  });
});
