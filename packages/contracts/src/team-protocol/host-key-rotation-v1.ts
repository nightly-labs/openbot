// Frozen optional host-key-rotation-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: the owner of a server can
// ask the host to change its Ed25519 key from another device, as the owner can in Server settings on
// the host computer. The host makes the new key itself, signs one handover with the current and the
// new key (`host-key-handover.ts`), and answers only after the account service accepts it. No key
// leaves the host: the answer carries only the new public key. A rotation that is already pending is
// sent again, not replaced. Each client follows the signed handover from the key that it trusts. An
// admin or a member gets 403; `requireOwner` on the host is the only gate. Widening any of it needs a
// second capability string.
import { adminRoute, empty, fields, type OptionalRouteCodec, string } from "./admin-wire";

export const HOST_KEY_ROTATION_CAPABILITY = "host-key-rotation-v1";

export const HOST_KEY_ROTATION_ROUTES = {
  rotate: "/v1/admin/host/key/rotate",
} as const;

/** The SPKI PEM that the host uses after the change. The same bound as a handover key. */
const rotated = fields({ publicKey: string(512) });

export const HOST_KEY_ROTATION_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_KEY_ROTATION_ROUTES.rotate, adminRoute(empty, rotated)],
]);
