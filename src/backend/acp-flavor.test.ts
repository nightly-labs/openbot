import { RequestError } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { customAgentFlavor } from "./acp-flavor";

const SID = "b3f4a59b-c90e-47bb-af51-432218d30be0";

const internalError = (details: unknown) => new RequestError(-32603, "Internal error", { details });

describe("customAgentFlavor sessionNotFound", () => {
  const flavor = customAgentFlavor("openclaw");

  it("recognizes an OpenClaw gateway error: -32603 with `Session <id> not found` in details", () => {
    expect(flavor.sessionNotFound?.(internalError(`Session ${SID} not found`), SID)).toBe(true);
  });

  it("keeps recognizing the Oh My Pi wording", () => {
    expect(flavor.sessionNotFound?.(internalError(`Unsupported ACP session: ${SID}`), SID)).toBe(true);
  });

  it("rejects other -32603 details", () => {
    expect(flavor.sessionNotFound?.(internalError("some other internal problem"), SID)).toBe(false);
  });

  it("rejects a different session id in the details", () => {
    expect(flavor.sessionNotFound?.(internalError("Session another-session not found"), SID)).toBe(false);
  });

  it("rejects details that merely mention the id", () => {
    expect(flavor.sessionNotFound?.(internalError(`retry failed for ${SID}`), SID)).toBe(false);
  });

  it("leaves non -32603 errors to the generic protocol check", () => {
    expect(flavor.sessionNotFound?.(new RequestError(-32002, "Session not found", { sessionId: SID }), SID)).toBeNull();
  });
});
