import { createIngressQueueKeyPair } from "@openbot/contracts/signal-protocol/ingress-queue";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { IngressQueue, type RouteWake, type RouteWaker } from "../src/ingress-queue";

const route = { platform: "telegram", botId: "777000111", chatId: "-100" } as const;
const message = { type: "telegram-delivery", version: 1, botId: "777000111", chatId: "-100", bodyBase64: "" } as const;

// A message that a sleeping server never gets is lost: Telegram and Discord do not send it again.
describe("IngressQueue", () => {
  it("starts the server for a message that came during a lookup with no start", async () => {
    const asked: boolean[] = [];
    let answerLookup: (answer: RouteWake) => void = () => undefined;
    const waker: RouteWaker = (_route, wake) => {
      asked.push(wake);
      if (!wake)
        return Effect.promise(
          () =>
            new Promise<RouteWake>((resolve) => {
              answerLookup = resolve;
            }),
        );
      return Effect.succeed({ hostId: "host-1", state: "starting" });
    };
    const queue = new IngressQueue(waker);
    queue.rememberKey("host-1", (await createIngressQueueKeyPair()).publicKey);

    const lookup = Effect.runPromise(queue.offline(route, "telegram:-100", false, message));
    const addressed = Effect.runPromise(queue.offline(route, "telegram:-100", true, message));
    answerLookup({ hostId: "host-1", state: "sleeping" });

    await expect(lookup).resolves.toBe("hosted");
    await expect(addressed).resolves.toBe("queued");
    expect(asked).toEqual([false, true]);
  });

  it("does not remember an account service that did not answer", async () => {
    let answers = 0;
    const queue = new IngressQueue(() => {
      answers += 1;
      return Effect.succeed(answers === 1 ? null : { hostId: "host-1", state: "starting" as const });
    });
    queue.rememberKey("host-1", (await createIngressQueueKeyPair()).publicKey);

    await expect(Effect.runPromise(queue.offline(route, "telegram:-100", true, message))).resolves.toBe("unavailable");
    await expect(Effect.runPromise(queue.offline(route, "telegram:-100", true, message))).resolves.toBe("queued");
    queue.close();
  });

  it("asks again for the start of a server that keeps events and does not connect", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let now = 1_000_000;
      const asked: boolean[] = [];
      const queue = new IngressQueue(
        (_route, wake) => {
          asked.push(wake);
          return Effect.succeed({ hostId: "host-1", state: "starting" as const });
        },
        { now: () => now },
      );
      queue.rememberKey("host-1", (await createIngressQueueKeyPair()).publicKey);
      await expect(Effect.runPromise(queue.offline(route, "telegram:-100", true, message))).resolves.toBe("queued");

      // Within one check interval nothing is asked again.
      vi.advanceTimersByTime(30_000);
      expect(asked).toEqual([true]);
      now += 61_000;
      vi.advanceTimersByTime(30_000);
      await vi.waitFor(() => expect(asked).toEqual([true, true]));
      queue.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
