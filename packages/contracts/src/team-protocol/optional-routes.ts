// The optional admin routes, one table. `teamSideRouteCodec` in `side-routes.ts` asks here, so every
// HTTP and WebRTC transport encodes an admin route with its frozen codec. A path that is not listed
// goes to the protocol adapter.
import type { OptionalRouteCodec } from "./admin-wire";
import { AGENT_ADMIN_CODECS } from "./agent-admin-v1";
import { AGENT_IMPORT_CODECS } from "./agent-import-v1";
import { AGENT_INSTALL_CODECS } from "./agent-install-v1";
import { AGENT_PUBLISH_CODECS } from "./agent-publish-v1";
import { AGENT_UPDATE_CODECS } from "./agent-update-v1";
import { CONTEXT_RESET_CODECS } from "./context-reset-v1";
import { EVENTS_CODECS } from "./events-v1";
import { HOST_ADMIN_CODECS } from "./host-admin-v1";
import { HOST_MEMBER_UPDATE_CODECS } from "./host-member-update-v1";
import { HOST_RELEASE_CODECS } from "./host-release-v1";
import { HOST_UPDATE_CODECS } from "./host-update-v1";
import { HOSTED_SITES_CODECS } from "./hosted-sites-v1";
import { LIVE_ACTIVITY_PUSH_CODECS } from "./live-activity-push-v1";
import { PROVIDERS_ADMIN_CODECS } from "./providers-v1";
import { PROVIDERS_RUNTIMES_V2_CODECS } from "./providers-v2";
import { PROVIDERS_SIGN_IN_V3_CODECS } from "./providers-v3";
import { PROVIDERS_V4_CODECS } from "./providers-v4";
import { SHARED_TABLES_CODECS } from "./shared-tables-v1";
import { SKILLS_ADMIN_CODECS } from "./skills-admin-v1";
import { WORKSPACE_DIRECTORY_CODECS } from "./workspace-directory-v1";

export type { OptionalRouteCodec } from "./admin-wire";

const CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  ...AGENT_ADMIN_CODECS,
  ...SKILLS_ADMIN_CODECS,
  ...SHARED_TABLES_CODECS,
  ...AGENT_INSTALL_CODECS,
  ...AGENT_UPDATE_CODECS,
  ...PROVIDERS_ADMIN_CODECS,
  ...PROVIDERS_RUNTIMES_V2_CODECS,
  ...PROVIDERS_SIGN_IN_V3_CODECS,
  ...PROVIDERS_V4_CODECS,
  ...HOST_ADMIN_CODECS,
  ...HOST_UPDATE_CODECS,
  ...HOST_RELEASE_CODECS,
  ...HOST_MEMBER_UPDATE_CODECS,
  ...CONTEXT_RESET_CODECS,
  ...EVENTS_CODECS,
  ...AGENT_IMPORT_CODECS,
  ...AGENT_PUBLISH_CODECS,
  ...LIVE_ACTIVITY_PUSH_CODECS,
  ...HOSTED_SITES_CODECS,
  ...WORKSPACE_DIRECTORY_CODECS,
]);

export function optionalRouteCodec(path: string): OptionalRouteCodec | undefined {
  return CODECS.get(new URL(path, "http://openbot.invalid").pathname);
}
