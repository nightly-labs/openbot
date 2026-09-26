// The optional admin routes, one table. `teamSideRouteCodec` in `side-routes.ts` asks here, so every
// HTTP and WebRTC transport encodes an admin route with its frozen codec. A path that is not listed
// goes to the protocol adapter.
import type { OptionalRouteCodec } from "./admin-wire";
import { AGENT_ADMIN_CODECS } from "./agent-admin-v1";
import { AGENT_INSTALL_CODECS } from "./agent-install-v1";
import { HOST_ADMIN_CODECS } from "./host-admin-v1";
import { PROVIDERS_ADMIN_CODECS } from "./providers-v1";
import { SHARED_TABLES_CODECS } from "./shared-tables-v1";
import { SKILLS_ADMIN_CODECS } from "./skills-admin-v1";

export type { OptionalRouteCodec } from "./admin-wire";

const CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  ...AGENT_ADMIN_CODECS,
  ...SKILLS_ADMIN_CODECS,
  ...SHARED_TABLES_CODECS,
  ...AGENT_INSTALL_CODECS,
  ...PROVIDERS_ADMIN_CODECS,
  ...HOST_ADMIN_CODECS,
]);

export function optionalRouteCodec(path: string): OptionalRouteCodec | undefined {
  return CODECS.get(new URL(path, "http://openbot.invalid").pathname);
}
