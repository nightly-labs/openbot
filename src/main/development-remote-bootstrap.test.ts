import type { CentralAuthState } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { ensureDevelopmentAccount } from "./development-remote-bootstrap";

const email = "openbot-dev-host@example.com";
const user = { id: "seeded-owner", email, name: null, avatarUrl: null };
const cooldown: CentralAuthState = {
  status: "error",
  issue: {
    code: "code_recently_sent",
    message: "Wait 8 seconds before requesting another code.",
    retryAfterSeconds: 8,
  },
};

function authManager() {
  return {
    initialize: vi
      .fn<() => Effect.Effect<CentralAuthState>>()
      .mockReturnValue(Effect.succeed({ status: "signed_out" })),
    logout: vi.fn<() => Effect.Effect<CentralAuthState>>().mockReturnValue(Effect.succeed({ status: "signed_out" })),
    requestEmailCode: vi.fn<(email: string) => Effect.Effect<CentralAuthState>>().mockReturnValue(
      Effect.succeed({
        status: "code_sent",
        email,
        challengeId: "challenge",
        developmentCode: "123456",
        expiresAt: Date.now() + 600_000,
        resendAvailableAt: Date.now() + 60_000,
      }),
    ),
    verifyEmailCode: vi
      .fn<(id: string, code: string) => Effect.Effect<CentralAuthState>>()
      .mockReturnValue(Effect.succeed({ status: "signed_in", user })),
  };
}

afterEach(() => vi.useRealTimers());

it("signs the seeded owner in after another dev instance triggered the resend cooldown", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const manager = authManager();
  manager.requestEmailCode.mockReturnValueOnce(Effect.succeed(cooldown));
  const signedIn = runCauseEffect(ensureDevelopmentAccount(manager, email));
  await vi.advanceTimersByTimeAsync(7_999);
  expect(manager.verifyEmailCode).not.toHaveBeenCalled();
  expect(manager.requestEmailCode).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(signedIn).resolves.toEqual(user);
  expect(manager.requestEmailCode).toHaveBeenLastCalledWith(email);
  expect(manager.verifyEmailCode).toHaveBeenCalledWith("challenge", "123456");
});

it("stops after one cooldown retry and reports the API error", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const manager = authManager();
  manager.requestEmailCode.mockReturnValue(Effect.succeed(cooldown));
  const rejected = expect(runCauseEffect(ensureDevelopmentAccount(manager, email))).rejects.toThrow(
    cooldown.issue.message,
  );
  await vi.advanceTimersByTimeAsync(8_000);
  await rejected;
  expect(manager.requestEmailCode).toHaveBeenCalledTimes(2);
});

it("reuses an existing seeded session without requesting another code", async () => {
  const manager = authManager();
  manager.initialize.mockReturnValue(Effect.succeed({ status: "signed_in", user }));
  await expect(runCauseEffect(ensureDevelopmentAccount(manager, email))).resolves.toEqual(user);
  expect(manager.requestEmailCode).not.toHaveBeenCalled();
});

it("reports non-cooldown sign-in failures without retrying", async () => {
  const manager = authManager();
  manager.requestEmailCode.mockReturnValue(
    Effect.succeed({
      status: "error",
      issue: { code: "email_rate_limited", message: "Too many requests." },
    }),
  );
  await expect(runCauseEffect(ensureDevelopmentAccount(manager, email))).rejects.toThrow("Too many requests.");
  expect(manager.requestEmailCode).toHaveBeenCalledTimes(1);
});
