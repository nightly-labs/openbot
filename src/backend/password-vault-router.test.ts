import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "./effect-boundary";
import { type PasswordVault, PasswordVaultError } from "./password-vault";
import { passwordVaultRouter } from "./password-vault-router";

function vault(value: string): PasswordVault {
  return {
    connected: () => true,
    loginsFor: () => Effect.succeed([{ id: "same-id", title: value, username: null, hasOneTimePassword: false }]),
    secretFor: vi.fn(() => Effect.succeed(value)),
  };
}
describe("password vault routing", () => {
  it("keeps existing ids and routes a colliding Bitwarden id to its source only", async () => {
    const first = vault("first");
    const second = vault("second");
    const router = passwordVaultRouter(first, second);
    expect((await runCauseEffect(router.loginsFor("https://example.com")))?.map((item) => item.id)).toEqual([
      "same-id",
      "bitwarden:same-id",
    ]);
    expect(await runCauseEffect(router.secretFor("same-id", "https://example.com", "password"))).toBe("first");
    expect(await runCauseEffect(router.secretFor("bitwarden:same-id", "https://example.com", "totp"))).toBe("second");
    expect(second.secretFor).toHaveBeenCalledWith("same-id", "https://example.com", "totp");
    expect(first.secretFor).toHaveBeenCalledOnce();
  });
  it("does not silently select a remaining account when a source fails", async () => {
    const first = vault("first");
    first.loginsFor = () => Effect.fail(new PasswordVaultError({ cause: new Error("Unavailable") }));
    await expect(
      runCauseEffect(passwordVaultRouter(first, vault("second")).loginsFor("https://example.com")),
    ).rejects.toThrow("Unavailable");
  });
});
