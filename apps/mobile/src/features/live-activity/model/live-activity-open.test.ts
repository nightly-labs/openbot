import {
  encodeLiveActivityBytes,
  LIVE_ACTIVITY_NONCE_BYTES,
  LIVE_ACTIVITY_SECRET_BYTES,
  liveActivityKeys,
  sealLiveActivity,
} from "@openbot/team-client/live-activity-seal";
import { describe, expect, it } from "vitest";
import { openSealedLiveActivity } from "./live-activity-open";

const keys = liveActivityKeys(Uint8Array.from({ length: LIVE_ACTIVITY_SECRET_BYTES }, (_, index) => index));
const seal = encodeLiveActivityBytes(keys.seal);
const tag = encodeLiveActivityBytes(keys.tag);
const nonce = new Uint8Array(LIVE_ACTIVITY_NONCE_BYTES).fill(3);

describe("sealed Live Activity props", () => {
  it("opens in the widget what the host sealed, in every language", () => {
    const text = JSON.stringify({ title: "Ada", detail: `Déployer ? 展開しますか 🚀 ${"x".repeat(300)}` });

    expect(openSealedLiveActivity(sealLiveActivity(text, keys, nonce), seal, tag)).toBe(text);
    expect(openSealedLiveActivity(sealLiveActivity("", keys, nonce), seal, tag)).toBe("");
  });

  it("shows nothing that another key sealed or that the relay changed", () => {
    const sealed = sealLiveActivity(JSON.stringify({ mode: "approval" }), keys, nonce);
    const other = liveActivityKeys(new Uint8Array(LIVE_ACTIVITY_SECRET_BYTES).fill(9));
    const changed = `${sealed.slice(0, 30)}${sealed[30] === "A" ? "B" : "A"}${sealed.slice(31)}`;

    expect(openSealedLiveActivity(sealLiveActivity("{}", other, nonce), seal, tag)).toBeNull();
    expect(openSealedLiveActivity(changed, seal, tag)).toBeNull();
    expect(openSealedLiveActivity("not base64!", seal, tag)).toBeNull();
  });
});
