import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import {
  GITHUB_ACCESS_TOKEN_URL,
  type GitHubDeviceCode,
  type GitHubFetch,
  pollGitHubDeviceToken,
  refreshGitHubToken,
} from "./github-device-flow";

const DEVICE: GitHubDeviceCode = {
  deviceCode: "device-code",
  userCode: "WDJB-MJHT",
  verificationUri: "https://github.com/login/device",
  expiresAt: 900_000,
  intervalMs: 5_000,
};

const TOKEN = {
  access_token: "ghu_access",
  expires_in: 28_800,
  refresh_token: "ghr_refresh",
  refresh_token_expires_in: 15_897_600,
};

/** GitHub's answers in order, and the time and form of each request. */
function github(...answers: object[]) {
  const requests: { at: number; form: URLSearchParams }[] = [];
  const fetch: GitHubFetch = async (url, init) => {
    expect(url).toBe(GITHUB_ACCESS_TOKEN_URL);
    requests.push({ at: Date.now(), form: new URLSearchParams(String(init.body)) });
    const answer = answers.shift();
    if (!answer) throw new Error("No answer left.");
    return Response.json(answer);
  };
  return { fetch, requests };
}

describe("GitHub device flow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits while the user has not answered, and slows down when GitHub asks", async () => {
    const { fetch, requests } = github(
      { error: "authorization_pending" },
      { error: "slow_down" },
      { error: "authorization_pending" },
      TOKEN,
    );
    const token = runCauseEffect(
      pollGitHubDeviceToken({
        clientId: "Iv1.client",
        fetch,
        device: DEVICE,
        signal: new AbortController().signal,
      }),
    );
    await vi.runAllTimersAsync();

    await expect(token).resolves.toEqual({
      accessToken: "ghu_access",
      accessTokenExpiresAt: 30_000 + 28_800_000,
      refreshToken: "ghr_refresh",
      refreshTokenExpiresAt: 30_000 + 15_897_600_000,
    });
    expect(requests.map((request) => request.at)).toEqual([5_000, 10_000, 20_000, 30_000]);
    expect(requests[0]?.form.get("client_secret")).toBeNull();
  });

  it.each([
    ["access_denied", "denied"],
    ["expired_token", "expired"],
    ["device_flow_disabled", "device_flow_disabled"],
  ])("stops when GitHub answers %s", async (error, failure) => {
    const { fetch, requests } = github({ error });
    const token = runCauseEffect(
      pollGitHubDeviceToken({
        clientId: "Iv1.client",
        fetch,
        device: DEVICE,
        signal: new AbortController().signal,
      }),
    );
    const settled = expect(token).rejects.toMatchObject({ failure });
    await vi.runAllTimersAsync();
    await settled;
    expect(requests).toHaveLength(1);
  });

  it("asks again after a network failure", async () => {
    const { fetch: answer, requests } = github(TOKEN);
    let failures = 1;
    const fetch: GitHubFetch = async (url, init) => {
      if (failures-- > 0) throw new TypeError("fetch failed");
      return answer(url, init);
    };
    const token = runCauseEffect(
      pollGitHubDeviceToken({
        clientId: "Iv1.client",
        fetch,
        device: DEVICE,
        signal: new AbortController().signal,
      }),
    );
    await vi.runAllTimersAsync();

    await expect(token).resolves.toMatchObject({ accessToken: "ghu_access" });
    expect(requests.map((request) => request.at)).toEqual([10_000]);
  });

  it("stops asking when the sign-in is cancelled", async () => {
    const { fetch, requests } = github({ error: "authorization_pending" });
    const controller = new AbortController();
    const token = runCauseEffect(
      pollGitHubDeviceToken({ clientId: "Iv1.client", fetch, device: DEVICE, signal: controller.signal }),
    );
    const settled = expect(token).rejects.toBe("cancelled");
    await vi.advanceTimersByTimeAsync(5_000);
    controller.abort("cancelled");
    await settled;
    await vi.runAllTimersAsync();
    expect(requests).toHaveLength(1);
  });

  it("refreshes with the Client ID only", async () => {
    const { fetch, requests } = github(TOKEN);
    await expect(
      runCauseEffect(refreshGitHubToken({ clientId: "Iv1.client", fetch, refreshToken: "ghr_old" })),
    ).resolves.toMatchObject({
      accessToken: "ghu_access",
      refreshToken: "ghr_refresh",
    });
    expect(Object.fromEntries(requests[0]?.form ?? [])).toEqual({
      client_id: "Iv1.client",
      grant_type: "refresh_token",
      refresh_token: "ghr_old",
    });
  });
});
