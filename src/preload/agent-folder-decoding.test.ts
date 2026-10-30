// @vitest-environment node

import {
  AGENT_FOLDER_LIMIT,
  decodeAgentExclusionChangeFromMain,
  decodeAgentFolderChangeFromMain,
  decodeAgentFolderListFromMain,
  isAgentAdditionalFolders,
} from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";

const LIST = {
  workspace: "/Users/sam/OpenBot/Agents/Chief",
  shared: "/Users/sam/OpenBot/Shared",
  folders: [
    { path: "/Users/sam/Projects/Leads", found: true },
    { path: "/Users/sam/Documents/Contracts", found: false },
  ],
  excluded: ["/Users/sam/Projects/Leads/Private"],
};

describe("decodeAgentFolderListFromMain", () => {
  it("keeps the workspace, the shared folder and each added folder", () => {
    expect(decodeAgentFolderListFromMain(LIST)).toEqual(LIST);
  });

  it("refuses a list without its excluded folders, or with a path that is not text", () => {
    const { excluded: _excluded, ...withoutExcluded } = LIST;
    expect(() => decodeAgentFolderListFromMain(withoutExcluded)).toThrow();
    expect(() => decodeAgentFolderListFromMain({ ...LIST, excluded: [7] })).toThrow();
  });

  it("refuses a folder without its found state", () => {
    expect(() => decodeAgentFolderListFromMain({ ...LIST, folders: [{ path: "/tmp" }] })).toThrow();
  });

  it("refuses more folders than an agent can have", () => {
    const folders = Array.from({ length: AGENT_FOLDER_LIMIT + 1 }, (_, index) => ({
      path: `/tmp/${index}`,
      found: true,
    }));
    expect(() => decodeAgentFolderListFromMain({ ...LIST, folders })).toThrow();
  });
});

describe("decodeAgentFolderChangeFromMain", () => {
  it("keeps each outcome with the fields it needs", () => {
    const changes = [
      { outcome: "cancelled", list: LIST },
      { outcome: "added", path: "/tmp/a", replaced: [], list: LIST },
      { outcome: "added", path: "/tmp", replaced: ["/tmp/a", "/tmp/b"], list: LIST },
      { outcome: "replaced", path: "/tmp/a", list: LIST },
      { outcome: "removed", path: "/tmp/a", list: LIST },
      { outcome: "covered", path: "/tmp/a/b", coverage: { reason: "in-folder", folder: "/tmp/a" }, list: LIST },
      { outcome: "refused", path: "/", refusal: "protected", list: LIST },
    ];
    for (const change of changes) expect(decodeAgentFolderChangeFromMain(change)).toEqual(change);
  });

  it("refuses an unknown outcome, reason or refusal, or a missing field", () => {
    for (const change of [
      { outcome: "granted", path: "/tmp/a", list: LIST },
      { outcome: "covered", path: "/tmp/a", coverage: { reason: "nearby", folder: "/tmp" }, list: LIST },
      { outcome: "refused", path: "/tmp/a", refusal: "busy", list: LIST },
      { outcome: "added", replaced: [], list: LIST },
      { outcome: "added", path: "/tmp/a", replaced: [] },
      { outcome: "added", path: "/tmp/a", list: LIST },
      { outcome: "added", path: "/tmp/a", replaced: [7], list: LIST },
    ])
      expect(() => decodeAgentFolderChangeFromMain(change)).toThrow();
  });
});

describe("decodeAgentExclusionChangeFromMain", () => {
  it("keeps each outcome with the fields it needs", () => {
    const changes = [
      { outcome: "cancelled", list: LIST },
      { outcome: "excluded", path: "/tmp/a", replaced: [], list: LIST },
      { outcome: "excluded", path: "/tmp", replaced: ["/tmp/a"], list: LIST },
      { outcome: "included", path: "/tmp/a", list: LIST },
      { outcome: "covered", path: "/tmp/a/b", folder: "/tmp/a", list: LIST },
      { outcome: "refused", path: "/tmp/a", refusal: "outside", list: LIST },
    ];
    for (const change of changes) expect(decodeAgentExclusionChangeFromMain(change)).toEqual(change);
  });

  it("refuses an unknown outcome or refusal, or a missing field", () => {
    for (const change of [
      { outcome: "added", path: "/tmp/a", replaced: [], list: LIST },
      { outcome: "refused", path: "/tmp/a", refusal: "protected", list: LIST },
      { outcome: "covered", path: "/tmp/a/b", list: LIST },
      { outcome: "excluded", path: "/tmp/a", list: LIST },
      { outcome: "included", path: "/tmp/a" },
    ])
      expect(() => decodeAgentExclusionChangeFromMain(change)).toThrow();
  });
});

describe("isAgentAdditionalFolders", () => {
  it("accepts a list of folder paths", () => {
    expect(isAgentAdditionalFolders(["/tmp/a", "/tmp/b"])).toBe(true);
  });

  it("refuses an empty path, a value that is not text, or too many folders", () => {
    expect(isAgentAdditionalFolders([""])).toBe(false);
    expect(isAgentAdditionalFolders([1])).toBe(false);
    expect(
      isAgentAdditionalFolders(Array.from({ length: AGENT_FOLDER_LIMIT + 1 }, (_, index) => `/tmp/${index}`)),
    ).toBe(false);
  });
});
