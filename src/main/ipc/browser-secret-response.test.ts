// @vitest-environment node

import {
  parseLocalBrowserSecretResponse,
  type RespondToBrowserSecretInput,
  remoteBrowserSecretResponse,
} from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";

const SUBMIT: RespondToBrowserSecretInput = { requestId: "r1", agentId: "a1", decision: "submit", secret: "hunter2" };

describe("parseLocalBrowserSecretResponse", () => {
  it("keeps Save to Vault only for a submitted secret", () => {
    expect(parseLocalBrowserSecretResponse({ ...SUBMIT, saveToVault: true })).toEqual({ ...SUBMIT, saveToVault: true });
    expect(parseLocalBrowserSecretResponse(SUBMIT)).toEqual(SUBMIT);
    expect(() =>
      parseLocalBrowserSecretResponse({ requestId: "r1", agentId: "a1", decision: "cancel", saveToVault: true }),
    ).toThrow();
  });

  it.each([false, "true", 1, null])("refuses saveToVault %j without the secret in the error", (saveToVault) => {
    expect(() => parseLocalBrowserSecretResponse({ ...SUBMIT, saveToVault })).toThrow(
      "Invalid secure authentication response.",
    );
  });
});

describe("remoteBrowserSecretResponse", () => {
  it("sends only the released fields to a remote server", () => {
    expect(remoteBrowserSecretResponse({ ...SUBMIT, saveToVault: true })).toEqual(SUBMIT);
    expect(remoteBrowserSecretResponse({ requestId: 2, agentId: "a1", decision: "takeover" })).toEqual({
      requestId: 2,
      agentId: "a1",
      decision: "takeover",
    });
  });
});
