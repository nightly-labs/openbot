import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { BROWSER_DYNAMIC_TOOLS, parseBrowserToolCall } from "./browser-tools";
import type { PasswordVault, VaultLogin } from "./password-vault";
import { passwordVaultRouter } from "./password-vault-router";

// Synthetic ids with the structure of Proton Pass share and item ids (base64url, 88 characters).
// No real vault, login or secret is used.
const protonPart = (seed: string, length = 88) => `${seed.repeat(length).slice(0, length - 2)}==`;
const SHARE_ID = protonPart("AbC1_-x");
const ITEM_ID = protonPart("zY9-_Qw");
const PROTON_LOGIN_ID = `proton:${SHARE_ID}:${ITEM_ID}`;
// The longest id that the Proton Pass driver can make: 256-character share and item ids.
const LONGEST_PROTON_LOGIN_ID = `proton:${"a".repeat(256)}:${"b".repeat(256)}`;

const submitSecretArgs = (loginId: string) => ({
  tabId: "tab-1",
  method: "password",
  targets: [{ kind: "ref", ref: "e12", revision: 3 }],
  submission: "click",
  submitTarget: { kind: "ref", ref: "e14", revision: 3 },
  loginId,
});

describe("submit_secret loginId", () => {
  it("accepts the full Proton Pass id that list_logins returns", () => {
    expect(PROTON_LOGIN_ID.length).toBeGreaterThan(128);
    const call = parseBrowserToolCall("submit_secret", submitSecretArgs(PROTON_LOGIN_ID));
    expect(call.tool).toBe("submit_secret");
    expect(call.tool === "submit_secret" ? call.args.loginId : undefined).toBe(PROTON_LOGIN_ID);
  });

  it("accepts the longest id that the Proton Pass driver can make", () => {
    const call = parseBrowserToolCall("submit_secret", submitSecretArgs(LONGEST_PROTON_LOGIN_ID));
    expect(call.tool === "submit_secret" ? call.args.loginId : undefined).toBe(LONGEST_PROTON_LOGIN_ID);
  });

  it("still rejects an empty or oversized loginId", () => {
    expect(() => parseBrowserToolCall("submit_secret", submitSecretArgs(""))).toThrow();
    expect(() => parseBrowserToolCall("submit_secret", submitSecretArgs(`${LONGEST_PROTON_LOGIN_ID}x`))).toThrow();
  });

  it("advertises a loginId limit that fits the Proton Pass id", () => {
    const tool = BROWSER_DYNAMIC_TOOLS[0]?.tools.find(({ name }) => name === "submit_secret");
    expect(INPUT_LIMITS.vaultLoginId).toBeGreaterThanOrEqual(LONGEST_PROTON_LOGIN_ID.length);
    expect(tool?.inputSchema).toMatchObject({ properties: { loginId: { maxLength: INPUT_LIMITS.vaultLoginId } } });
  });
});

describe("password vault router with Proton Pass ids", () => {
  const protonVault = (seen: string[]): PasswordVault => ({
    connected: () => true,
    loginsFor: () =>
      Effect.succeed<VaultLogin[]>([
        { id: `${SHARE_ID}:${ITEM_ID}`, title: "Example", username: "user@example.test", hasOneTimePassword: false },
      ]),
    secretFor: (id) =>
      Effect.sync(() => {
        seen.push(id);
        return id === `${SHARE_ID}:${ITEM_ID}` ? "synthetic-value" : null;
      }),
  });

  it("lists the prefixed id that submit_secret accepts and fills from the full id", async () => {
    const seen: string[] = [];
    const router = passwordVaultRouter([{ prefix: "proton:", vault: protonVault(seen) }]);
    const logins = await Effect.runPromise(router.loginsFor("https://accounts.example.test"));
    expect(logins?.map(({ id }) => id)).toEqual([PROTON_LOGIN_ID]);
    const id = logins?.[0]?.id ?? "";
    const call = parseBrowserToolCall("submit_secret", submitSecretArgs(id));
    const loginId = call.tool === "submit_secret" ? call.args.loginId : undefined;
    expect(loginId).toBe(PROTON_LOGIN_ID);
    const secret = await Effect.runPromise(
      router.secretFor(loginId ?? "", "https://accounts.example.test", "password"),
    );
    expect(secret).toBe("synthetic-value");
    expect(seen).toEqual([`${SHARE_ID}:${ITEM_ID}`]);
  });

  it("does not list an id that submit_secret would reject", async () => {
    const tooLong = `${"a".repeat(300)}:${"b".repeat(300)}`;
    const vault: PasswordVault = {
      connected: () => true,
      loginsFor: () =>
        Effect.succeed<VaultLogin[]>([
          { id: tooLong, title: "Too long", username: null, hasOneTimePassword: false },
          { id: `${SHARE_ID}:${ITEM_ID}`, title: "Example", username: null, hasOneTimePassword: false },
        ]),
      secretFor: () => Effect.succeed(null),
    };
    const router = passwordVaultRouter([{ prefix: "proton:", vault }]);
    const logins = await Effect.runPromise(router.loginsFor("https://accounts.example.test"));
    expect(logins?.map(({ id }) => id)).toEqual([PROTON_LOGIN_ID]);
  });
});
