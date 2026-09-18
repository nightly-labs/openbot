import type { QueueSnapshot } from "@openbot/contracts/ipc";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { applyMobileQueueEvent } from "./queue-cache";

it("replaces an in-flight initial read when the host invalidates the queue", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["chat-queue", "host", "agent"];
  let resolveOld = (_value: QueueSnapshot) => {};
  const old = new Promise<QueueSnapshot>((resolve) => {
    resolveOld = resolve;
  });
  const fresh: QueueSnapshot = { agentId: "agent", deliveries: [] };
  let calls = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: () => (++calls === 1 ? old : Promise.resolve(fresh)),
  });
  const unsubscribe = observer.subscribe(() => {});
  await applyMobileQueueEvent(client, "host", { type: "queue-invalidated", agentId: "agent" });
  resolveOld({ agentId: "old-read", deliveries: [] });
  await old;
  expect(calls).toBe(2);
  expect(client.getQueryData(key)).toEqual(fresh);
  unsubscribe();
  client.clear();
});
it("applies a direct queue snapshot only to its host and ignores a superseded read", async () => {
  const client = new QueryClient();
  const key = ["chat-queue", "host", "agent"];
  let resolve = (_value: QueueSnapshot) => {};
  const old = new Promise<QueueSnapshot>((done) => {
    resolve = done;
  });
  const pending = client.fetchQuery({ queryKey: key, queryFn: () => old }).catch(() => null);
  const snapshot: QueueSnapshot = { agentId: "agent", deliveries: [] };
  await applyMobileQueueEvent(client, "host", { type: "queue-changed", snapshot });
  resolve({ agentId: "old-read", deliveries: [] });
  await pending;
  expect(client.getQueryData(key)).toEqual(snapshot);
  expect(client.getQueryData(["chat-queue", "other-host", "agent"])).toBeUndefined();
  client.clear();
});
