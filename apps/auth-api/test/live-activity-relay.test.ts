import { exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import { ApnsLiveActivitySender, readLiveActivityRelayPush } from "../src/server/live-activity-relay";

const token = "ab".repeat(32);
const body = {
  machineToken: "machine",
  token,
  environment: "production",
  event: "update",
  sealed: "c2VhbGVk",
  timestamp: 1_790_000_000,
  staleAt: 1_790_000_900,
  priority: 10,
};

async function sender(respond: () => Response) {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const fetch = vi.fn(async (_input: string, _init: RequestInit) => respond());
  const apns = new ApnsLiveActivitySender(
    {
      privateKey: await exportPKCS8(privateKey),
      keyId: "KEY1234567",
      teamId: "ZTRDTUL87R",
      topic: "run.openbot.mobile",
    },
    fetch,
  );
  return { apns, fetch };
}

describe("Live Activity relay", () => {
  it("sends the sealed props as a Live Activity update with no text of its own", async () => {
    const { apns, fetch } = await sender(() => new Response(null, { status: 200 }));
    const push = readLiveActivityRelayPush({ ...body, alert: { title: "Pay now" } });
    if (!push) throw new Error("The update was not read.");

    expect(await apns.send(push)).toBe("sent");
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.push.apple.com/3/device/${token}`);
    expect(init?.headers).toMatchObject({
      "apns-push-type": "liveactivity",
      "apns-topic": "run.openbot.mobile.push-type.liveactivity",
      "apns-priority": "10",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      aps: {
        timestamp: body.timestamp,
        event: "update",
        "content-state": { name: "AgentActivity", props: JSON.stringify({ sealed: body.sealed }) },
        "stale-date": body.staleAt,
      },
    });
  });

  it("refuses a token or sealed value that could leave the device path or the payload", () => {
    expect(readLiveActivityRelayPush({ ...body, token: "../../3/device/ab" })).toBeNull();
    expect(readLiveActivityRelayPush({ ...body, sealed: '","alert":"x' })).toBeNull();
    expect(readLiveActivityRelayPush({ ...body, sealed: "a".repeat(4_000) })).toBeNull();
    expect(readLiveActivityRelayPush({ ...body, event: "start" })).toBeNull();
    expect(readLiveActivityRelayPush({ ...body, event: "end", sealed: null, staleAt: null })).not.toBeNull();
  });

  it("tells the host when Apple no longer knows the token, so it stops sending", async () => {
    const push = readLiveActivityRelayPush({ ...body, environment: "development" });
    if (!push) throw new Error("The update was not read.");

    const gone = await sender(() => new Response(null, { status: 410 }));
    expect(await gone.apns.send(push)).toBe("gone");
    expect(gone.fetch.mock.calls[0]?.[0]).toContain("api.sandbox.push.apple.com");
    const refused = await sender(() => Response.json({ reason: "BadDeviceToken" }, { status: 400 }));
    expect(await refused.apns.send(push)).toBe("gone");
    const busy = await sender(() => new Response(null, { status: 503 }));
    expect(await busy.apns.send(push)).toBe("unavailable");
  });
});
