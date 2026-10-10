// The agent-profile-generation payloads on protocol 7. Drafts and requests keep their v4 shape; only a
// saved agent is read with the v7 schema, which knows Cursor and Cline.
import { isDynamicRecord } from "../runtime-values";
import { decodeProfileV4Draft } from "./profile-v4";
import { decodeTeamProtocolV7BaseHttpResponse, type TeamProtocolV7BaseJsonObject } from "./v7-base";

export { decodeProfileV4Request as decodeProfileV7Request } from "./profile-v4";

export function decodeProfileV7Response(generate: boolean, value: unknown): TeamProtocolV7BaseJsonObject {
  if (generate) return decodeProfileV4Draft(value, true);
  if (!isDynamicRecord(value)) throw new Error("Invalid profile v7 response.");
  return {
    agent: decodeTeamProtocolV7BaseHttpResponse("PATCH", "/v1/agents/profile-saved", 200, value.agent),
    layout: decodeTeamProtocolV7BaseHttpResponse("GET", "/v1/sidebar-layout", 200, value.layout),
  };
}
