import { beforeEach, expect, it } from "vitest";
import { CHANNEL_SELECTION_STORAGE_KEY, readChannelSelection, writeChannelSelection } from "./channel-selection";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("channel selection storage", () => {
  let target: ReturnType<typeof storage>;

  beforeEach(() => {
    target = storage();
  });

  it("keeps selections separate for each account and server", () => {
    writeChannelSelection("user-1", "local", "channel-local", target);
    writeChannelSelection("user-1", "remote", "channel-remote", target);
    writeChannelSelection("user-2", "local", "channel-other", target);

    expect(readChannelSelection(target)).toEqual({
      "user-1": { local: "channel-local", remote: "channel-remote" },
      "user-2": { local: "channel-other" },
    });
  });

  it("removes only the selection that was closed", () => {
    writeChannelSelection("signed_out", "local", "channel-local", target);
    writeChannelSelection("signed_out", "remote", "channel-remote", target);
    writeChannelSelection("signed_out", "local", null, target);

    expect(readChannelSelection(target)).toEqual({ signed_out: { remote: "channel-remote" } });
  });

  it("ignores malformed stored data", () => {
    target.setItem(CHANNEL_SELECTION_STORAGE_KEY, "not json");

    expect(readChannelSelection(target)).toEqual({});
  });
});
