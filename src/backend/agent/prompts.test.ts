import { describe, expect, it } from "vitest";
import { mcpElicitationAutoAccept } from "./prompts";

describe("mcpElicitationAutoAccept", () => {
  const emptyAccess = {
    serverName: "notes",
    requestedSchema: { type: "object", properties: {} },
  };

  it("grants empty-schema access from any server when full access is on", () => {
    expect(mcpElicitationAutoAccept(emptyAccess, true)).toBe(true);
    expect(mcpElicitationAutoAccept(emptyAccess, false)).toBe(false);
  });

  it("does not grant a form that asks for fields", () => {
    expect(
      mcpElicitationAutoAccept(
        { serverName: "notes", requestedSchema: { type: "object", properties: { token: { type: "string" } } } },
        true,
      ),
    ).toBe(false);
  });
});
