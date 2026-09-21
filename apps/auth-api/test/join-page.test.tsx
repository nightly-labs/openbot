import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JoinPage } from "../src/components/landing/JoinPage";

const INVITE_URL =
  "https://openbot.run/join?api=https%3A%2F%2Fstudio-mac-k7m4q2pz-host.openbot.run%2F&server=00000000-0000-4000-8000-000000000000&fingerprint=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&invite=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("invitation landing page", () => {
  it("offers the desktop fallback without displaying the bearer token", async () => {
    window.history.replaceState({}, "", INVITE_URL);
    render(() => <JoinPage />);

    const openButton = await screen.findByRole("link", { name: "Open OpenBot" });
    await waitFor(() => expect(openButton).toHaveAttribute("href", expect.stringMatching(/^openbot:\/\/join\?/u)));
    expect(screen.getByRole("link", { name: "Download OpenBot" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("does not promise that every invitation is single-use or expires in 24 hours", async () => {
    window.history.replaceState({}, "", INVITE_URL);
    render(() => <JoinPage />);
    await screen.findByRole("link", { name: "Open OpenBot" });
    expect(document.body).not.toHaveTextContent(/one-time|only once|24 hours/u);
  });

  it.each([
    { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 },
    { userAgent: "Mozilla/5.0 (Linux; Android 16)", platform: "Linux", maxTouchPoints: 5 },
    { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 5 },
  ])("does not offer a desktop installer on a phone or iPad", async (device) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(device.userAgent);
    vi.spyOn(navigator, "platform", "get").mockReturnValue(device.platform);
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: device.maxTouchPoints });
    window.history.replaceState({}, "", INVITE_URL);
    render(() => <JoinPage />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Open OpenBot" })).toHaveAttribute(
        "href",
        expect.stringMatching(/^openbot:\/\/join\?/u),
      ),
    );
    expect(screen.queryByRole("link", { name: "Download OpenBot" })).not.toBeInTheDocument();
  });

  it("does not create an app link for an invalid invitation", async () => {
    window.history.replaceState({}, "", "/join?invite=bad");
    render(() => <JoinPage />);

    expect(
      await screen.findByText("This invitation link is invalid or incomplete. Ask the host for a new invitation."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open OpenBot" })).not.toBeInTheDocument();
  });
});
