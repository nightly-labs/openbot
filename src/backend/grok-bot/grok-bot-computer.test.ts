import { describe, expect, it } from "vitest";
import {
  buildGrokBotVncProxy,
  buildSandBoxNoVncUrl,
  parseGrokBotComputerStatus,
  proxifyBoxVncUrl,
} from "./grok-bot-computer";

const proxy = {
  primaryUrl: "http://127.0.0.1:6080/vnc.html?network_token=tok",
  forkBaseUrl: "http://127.0.0.1:6081",
  networkToken: "tok",
};

describe("grok bot computer", () => {
  it("rewrites the loopback primary display to the broker URL", () => {
    expect(proxifyBoxVncUrl("http://127.0.0.1:6080/vnc.html", proxy)).toBe(proxy.primaryUrl);
  });

  it("rewrites a fork display and keeps its display token", () => {
    const fork = `http://localhost:6081/vnc.html?path=${encodeURIComponent("websockify?token=abc")}`;
    expect(proxifyBoxVncUrl(fork, proxy)).toBe(buildSandBoxNoVncUrl(proxy.forkBaseUrl, "tok", "abc"));
  });

  it("projects BotAI forever-box phases", () => {
    expect(
      parseGrokBotComputerStatus({ state: "running", vncUrl: "http://127.0.0.1:6080/vnc.html" }, proxy).phase,
    ).toBe("running");
    expect(parseGrokBotComputerStatus({ state: "running", vncUrl: "http://127.0.0.1:6080/vnc.html" }, null).phase).toBe(
      "running",
    );
    expect(
      parseGrokBotComputerStatus({ state: "running", vncUrl: "https://box.example.cursorvm.com/vnc.html" }, null).phase,
    ).toBe("local");
    expect(parseGrokBotComputerStatus({ state: "hibernated", vncUrl: null }, proxy).phase).toBe("sleeping");
    expect(parseGrokBotComputerStatus({ state: "absent", vncUrl: null }, proxy).phase).toBe("off");
    expect(parseGrokBotComputerStatus({ state: "running", pull: { percent: 40 } }, proxy)).toMatchObject({
      phase: "pulling",
      pullPercent: 40,
    });
  });

  it("reports a handoff", () => {
    const status = parseGrokBotComputerStatus(
      { state: "running", handoff: { agentId: "a1", reason: "Log in" } },
      proxy,
    );
    expect(status).toMatchObject({ handoffAgentId: "a1", handoffReason: "Log in" });
  });

  it("accepts only a loopback viewer", () => {
    expect(buildGrokBotVncProxy("https://vnc.example.cursorvm.com/vnc.html", "https://f.example.com", "t")).toBeNull();
    expect(buildGrokBotVncProxy("http://user:pass@127.0.0.1:6080/vnc.html", "http://127.0.0.1:6081", "t")).toBeNull();
    expect(buildGrokBotVncProxy("http://127.0.0.1:6080/vnc.html", "http://127.0.0.1:6081", "t")).toEqual({
      primaryUrl: "http://127.0.0.1:6080/vnc.html",
      forkBaseUrl: "http://127.0.0.1:6081",
      networkToken: "t",
    });
  });
});
