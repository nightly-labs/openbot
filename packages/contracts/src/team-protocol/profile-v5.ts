// The agent-profile-generation payloads on protocol 5. Drafts and requests keep their v4 shape; only a
// saved agent is read with the v5 schema, which knows Gemini and custom ACP agents.
import { isDynamicRecord } from "../runtime-values";
import { decodeProfileV4Draft } from "./profile-v4";
import { decodeTeamProtocolV5BaseHttpResponse, type TeamProtocolV5BaseJsonObject } from "./v5-base";

export { decodeProfileV4Request as decodeProfileV5Request } from "./profile-v4";

export function decodeProfileV5Response(generate: boolean, value: unknown): TeamProtocolV5BaseJsonObject {
  if (generate) return decodeProfileV4Draft(value, true);
  if (!isDynamicRecord(value)) throw new Error("Invalid profile v5 response.");
  return {
    agent: decodeTeamProtocolV5BaseHttpResponse("PATCH", "/v1/agents/profile-saved", 200, value.agent),
    layout: decodeTeamProtocolV5BaseHttpResponse("GET", "/v1/sidebar-layout", 200, value.layout),
  };
}
