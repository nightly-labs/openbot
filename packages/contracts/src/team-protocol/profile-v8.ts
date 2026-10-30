// The agent-profile-generation payloads on protocol 8. Drafts and requests keep their v4 shape; only a
// saved agent is read with the v8 schema, which accepts an open provider id.
import { isDynamicRecord } from "../runtime-values";
import { decodeProfileV4Draft } from "./profile-v4";
import { decodeTeamProtocolV8BaseHttpResponse, type TeamProtocolV8BaseJsonObject } from "./v8-base";

export { decodeProfileV4Request as decodeProfileV8Request } from "./profile-v4";

export function decodeProfileV8Response(generate: boolean, value: unknown): TeamProtocolV8BaseJsonObject {
  if (generate) return decodeProfileV4Draft(value, true);
  if (!isDynamicRecord(value)) throw new Error("Invalid profile v8 response.");
  return {
    agent: decodeTeamProtocolV8BaseHttpResponse("PATCH", "/v1/agents/profile-saved", 200, value.agent),
    layout: decodeTeamProtocolV8BaseHttpResponse("GET", "/v1/sidebar-layout", 200, value.layout),
  };
}
