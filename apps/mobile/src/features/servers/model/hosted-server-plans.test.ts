import type { HostedServerState, HostedServerSummary } from "@openbot/contracts/hosted-servers";
import { describe, expect, it } from "vitest";
import { HostedRequestKeys, hostedServerLimit } from "./hosted-server-plans";

function server(serverId: string, state: HostedServerState): HostedServerSummary {
  return {
    serverId,
    name: "Cloud server",
    size: "default",
    plan: "standard",
    interval: "year",
    currency: "eur",
    state,
    error: null,
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
  };
}

function keys(): HostedRequestKeys {
  let next = 0;
  return new HostedRequestKeys(() => {
    next += 1;
    return `request-${String(next).padStart(12, "0")}`;
  });
}

// The Idempotency-Key decides whether the account server makes a second server and a second
// Checkout. A wrong key charges the user twice or blocks a paid purchase.
describe("hosted server request keys", () => {
  it("repeats the key of a choice whose create got no answer, so a retry does not make a second server", () => {
    const requests = keys();
    const first = requests.keyFor("standard", "year", "eur");
    requests.settle([]);
    expect(requests.keyFor("standard", "year", "eur").requestId).toBe(first.requestId);
  });

  it("repeats the key while the server waits for payment, and forgets it after the payment", () => {
    const requests = keys();
    const first = requests.keyFor("standard", "year", "eur");
    first.serverId = "server-1";
    requests.settle([server("server-1", "awaiting_payment")]);
    expect(requests.keyFor("standard", "year", "eur").requestId).toBe(first.requestId);

    requests.settle([server("server-1", "creating")]);
    expect(requests.keyFor("standard", "year", "eur").requestId).not.toBe(first.requestId);
  });

  it("forgets the key of a server that the account server removed after its payment page expired", () => {
    const requests = keys();
    const first = requests.keyFor("pro", "month", "usd");
    first.serverId = "server-1";
    requests.settle([]);
    expect(requests.keyFor("pro", "month", "usd").requestId).not.toBe(first.requestId);
  });

  it("gives each plan, billing period and currency its own key", () => {
    const requests = keys();
    const ids = new Set([
      requests.keyFor("standard", "year", "eur").requestId,
      requests.keyFor("standard", "month", "eur").requestId,
      requests.keyFor("standard", "year", "usd").requestId,
      requests.keyFor("pro", "year", "eur").requestId,
    ]);
    expect(ids.size).toBe(4);
  });
});

describe("hosted server limit", () => {
  it("counts only paid servers, because the account server replaces an unpaid one", () => {
    const paid = [server("a", "running"), server("b", "stopped")];
    expect(hostedServerLimit({ available: true, maxServers: 3, servers: paid })).toBeNull();
    expect(
      hostedServerLimit({ available: true, maxServers: 3, servers: [...paid, server("c", "awaiting_payment")] }),
    ).toBeNull();
    expect(hostedServerLimit({ available: true, maxServers: 3, servers: [...paid, server("c", "creating")] })).toBe(3);
  });
});
