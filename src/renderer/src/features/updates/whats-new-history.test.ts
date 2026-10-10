import { describe, expect, it } from "vitest";
import {
  claimWhatsNewVersion,
  readWhatsNewVersion,
  releaseVersion,
  selectWhatsNewReleases,
  WHATS_NEW_VERSION_KEY,
} from "./whats-new-history";
import { whatsNewReleasesSchema } from "./whats-new-releases";
import notes from "./whats-new-releases.json";

const whatsNewReleases = whatsNewReleasesSchema.parse(notes);

describe("release history", () => {
  it("selects only released notes between installed versions in numeric order", () => {
    expect(selectWhatsNewReleases(whatsNewReleases, "0.34.1", "0.33.0").map((release) => release.version)).toEqual([
      "0.34.1",
      "0.34.0",
    ]);
    expect(selectWhatsNewReleases(whatsNewReleases, "0.34.0", "0.9.0").map((release) => release.version)).toEqual([
      "0.34.0",
    ]);
    expect(selectWhatsNewReleases(whatsNewReleases, "0.34.1", null).map((release) => release.version)).toEqual([
      "0.34.1",
    ]);
    expect(releaseVersion("unavailable")).toBeNull();
    expect(releaseVersion("0.35.0-beta.1")).toBeNull();
  });
  it("keeps the highest consumed version and fails safely when storage is unavailable", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    expect(readWhatsNewVersion(storage)).toBeNull();
    expect(claimWhatsNewVersion(storage, "0.34.1")).toBe(true);
    expect(claimWhatsNewVersion(storage, "0.34.0")).toBe(false);
    expect(claimWhatsNewVersion(storage, "0.34.1")).toBe(false);
    expect(data.get(WHATS_NEW_VERSION_KEY)).toBe("0.34.1");
    const unavailable = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(readWhatsNewVersion(unavailable)).toBeNull();
    expect(claimWhatsNewVersion(unavailable, "0.34.1")).toBe(false);
  });
});
