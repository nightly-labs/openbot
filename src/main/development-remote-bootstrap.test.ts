import type { CentralAuthState } from "@openbot/contracts/ipc";
import { afterEach, expect, it, vi } from "vitest";
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
    initialize: vi.fn<() => Promise<CentralAuthState>>().mockResolvedValue({ status: "signed_out" }),
    logout: vi.fn<() => Promise<CentralAuthState>>().mockResolvedValue({ status: "signed_out" }),
    requestEmailCode: vi.fn<(email: string) => Promise<CentralAuthState>>().mockResolvedValue({
      status: "code_sent",
      email,
      challengeId: "challenge",
      developmentCode: "123456",
      expiresAt: Date.now() + 600_000,
      resendAvailableAt: Date.now() + 60_000,
    }),
    verifyEmailCode: vi
      .fn<(id: string, code: string) => Promise<CentralAuthState>>()
      .mockResolvedValue({ status: "signed_in", user }),
  };
}

afterEach(() => vi.useRealTimers());

it("signs the seeded owner in after another dev instance triggered the resend cooldown", async () => {
  vi.useFakeTimers();
  const manager = authManager();
  manager.requestEmailCode.mockResolvedValueOnce(cooldown);
  const signedIn = ensureDevelopmentAccount(manager, email);
  await vi.advanceTimersByTimeAsync(7_999);
  expect(manager.verifyEmailCode).not.toHaveBeenCalled();
  expect(manager.requestEmailCode).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(signedIn).resolves.toEqual(user);
  expect(manager.requestEmailCode).toHaveBeenLastCalledWith(email);
  expect(manager.verifyEmailCode).toHaveBeenCalledWith("challenge", "123456");
});

it("stops after one cooldown retry and reports the API error", async () => {
  vi.useFakeTimers();
  const manager = authManager();
  manager.requestEmailCode.mockResolvedValue(cooldown);
  const rejected = expect(ensureDevelopmentAccount(manager, email)).rejects.toThrow(cooldown.issue.message);
  await vi.advanceTimersByTimeAsync(8_000);
  await rejected;
  expect(manager.requestEmailCode).toHaveBeenCalledTimes(2);
});

it("reuses an existing seeded session without requesting another code", async () => {
  const manager = authManager();
  manager.initialize.mockResolvedValue({ status: "signed_in", user });
  await expect(ensureDevelopmentAccount(manager, email)).resolves.toEqual(user);
  expect(manager.requestEmailCode).not.toHaveBeenCalled();
});

it("reports non-cooldown sign-in failures without retrying", async () => {
  const manager = authManager();
  manager.requestEmailCode.mockResolvedValue({
    status: "error",
    issue: { code: "email_rate_limited", message: "Too many requests." },
  });
  await expect(ensureDevelopmentAccount(manager, email)).rejects.toThrow("Too many requests.");
  expect(manager.requestEmailCode).toHaveBeenCalledTimes(1);
});
