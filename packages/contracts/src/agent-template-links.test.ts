import { describe, expect, it } from "vitest";
import {
  agentTemplateShareOrigin,
  createAgentTemplateShareUrl,
  createOpenBotAgentTemplateUrl,
  isAgentTemplateShareOrigin,
  parseAgentTemplateUrl,
} from "./agent-template-links";
import { createPluginShareUrl } from "./plugin-links";

const id = "Ab3_-xYz0123456789abcd";

describe("OpenBot agent template links", () => {
  it("reads back the id it wrote, in either form", () => {
    expect(createAgentTemplateShareUrl(id)).toBe(`https://openbot.run/agents/${id}`);
    expect(createOpenBotAgentTemplateUrl(id)).toBe(`openbot://agents/${id}`);
    expect(parseAgentTemplateUrl(createAgentTemplateShareUrl(id))).toBe(id);
    expect(parseAgentTemplateUrl(createOpenBotAgentTemplateUrl(id))).toBe(id);
  });

  it("uses a local Worker in development and openbot.run otherwise", () => {
    expect(agentTemplateShareOrigin("http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100");
    expect(agentTemplateShareOrigin("https://api.openbot.run")).toBe("https://openbot.run");
    expect(createAgentTemplateShareUrl(id, "http://localhost:3100")).toBe(`http://localhost:3100/agents/${id}`);
  });

  it.each([
    "https://evil.example",
    "http://openbot.run",
    "http://127.0.0.1.evil.example:3100",
    "https://127.0.0.1:3100",
    "http://127.0.0.1:3100/path",
  ])("refuses the share origin %s", (origin) => {
    expect(isAgentTemplateShareOrigin(origin)).toBe(false);
    expect(() => createAgentTemplateShareUrl(id, origin)).toThrow();
  });

  it.each([
    ["a foreign origin", `https://evil.example/agents/${id}`],
    ["a host that only ends in the real one", `https://openbot.run.example.com/agents/${id}`],
    ["http", `http://openbot.run/agents/${id}`],
    ["a second path segment", `https://openbot.run/agents/${id}/install`],
    ["a query", `https://openbot.run/agents/${id}?install=1`],
    ["a hash", `openbot://agents/${id}#install`],
    ["a custom-scheme query", `openbot://agents/${id}?install=1`],
    ["a short id", "openbot://agents/abc"],
    ["a path in the id", "openbot://agents/..%2F..%2Fetc"],
    ["another custom-scheme host", `openbot://agent/${id}`],
    ["a plugin link", createPluginShareUrl("aave")],
    ["an invitation", "openbot://join"],
  ])("refuses %s", (_reason, value) => {
    expect(() => parseAgentTemplateUrl(value)).toThrow();
  });
});
