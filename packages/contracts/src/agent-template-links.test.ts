import { describe, expect, it } from "vitest";
import {
  createAgentTemplateShareUrl,
  createOpenBotAgentTemplateUrl,
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
