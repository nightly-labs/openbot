// The agent-profile-generation payloads on protocol 6. Drafts and requests keep their v4 shape; only a
// saved agent is read with the v6 schema, which knows Cursor and Cline.
import { isDynamicRecord } from "../runtime-values";
import { decodeProfileV4Draft } from "./profile-v4";
import { decodeTeamProtocolV6BaseHttpResponse, type TeamProtocolV6BaseJsonObject } from "./v6-base";

export { decodeProfileV4Request as decodeProfileV6Request } from "./profile-v4";

export function decodeProfileV6Response(generate: boolean, value: unknown): TeamProtocolV6BaseJsonObject {
  if (generate) return decodeProfileV4Draft(value, true);
  if (!isDynamicRecord(value)) throw new Error("Invalid profile v6 response.");
  return {
    agent: decodeTeamProtocolV6BaseHttpResponse("PATCH", "/v1/agents/profile-saved", 200, value.agent),
    layout: decodeTeamProtocolV6BaseHttpResponse("GET", "/v1/sidebar-layout", 200, value.layout),
  };
}
