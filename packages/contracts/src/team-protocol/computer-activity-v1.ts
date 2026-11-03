// Frozen optional computer-activity-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member's desktop
// app tells the host how many whole seconds ago the computer that it runs on last had keyboard or
// mouse input (`idleSeconds`, from the operating system, for all apps). The host answers whether it
// sends notifications to a phone of that member (`phones`). The host counts the input as use of
// that member, so its phones stay quiet while the member is at the computer, and keeps it in memory
// only. It is not use of a hosted server. A client sends it only after input, and not while the host
// answers `phones: false`, so a host without a phone of the member does not learn when the member is
// at the computer. Any host with phone notifications advertises it, and any member can send it.
// Widening any of it needs a second capability string.
import { adminRoute, boolean, count, fields, type OptionalRouteCodec } from "./admin-wire";

export const COMPUTER_ACTIVITY_CAPABILITY = "computer-activity-v1";

export const COMPUTER_ACTIVITY_ROUTES = { report: "/v1/client/activity" } as const;

export const COMPUTER_ACTIVITY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [COMPUTER_ACTIVITY_ROUTES.report, adminRoute(fields({ idleSeconds: count }), fields({ phones: boolean }))],
]);
