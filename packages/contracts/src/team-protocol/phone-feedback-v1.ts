// Frozen optional phone-feedback-v1 wire contract. The codec reads its bounds from literals, not IPC limits.
//
// What it grants, recorded here because freezing it makes it permanent: a member who can answer an
// approval of an agent (the `chat` level) sends a bug report about the phone app that the agent
// waits on, with the data that only the phone has: its system, its app version, its device, its kind
// of network with the name of the VPN that is on, and the last redacted lines of its support log. The host adds that data to the report, and the account
// service opens it as a public GitHub issue. The request answers the approval with "accept": the
// host refuses a plain "accept" of such a report, on each route, so no report about the phone app
// goes out without this data. Only the owner can send, as for each feedback approval. The host
// refuses a request that is not pending, a request of an agent that the client cannot see, and a
// request that is not a report about the phone app. Widening it needs a second capability string.
import { isString } from "../runtime-values";
import { type AdminDecoder, adminRoute, empty, fields, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const PHONE_FEEDBACK_CAPABILITY = "phone-feedback-v1";

export const PHONE_FEEDBACK_ROUTES = {
  send: "/v1/agent-approvals/send-phone-feedback",
} as const;

/** A provider request ID: an identifier or a finite number, as the `approval` event carries it. */
const requestId: AdminDecoder = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isString(value) && value.length > 0 && value.length <= 128) return value;
  throw new Error("Invalid approval request ID.");
};

export const PHONE_FEEDBACK_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PHONE_FEEDBACK_ROUTES.send,
    adminRoute(
      fields({
        requestId,
        phone: fields({
          platform: oneOf("iOS", "Android"),
          appVersion: string(200),
          system: string(200),
          network: string(200),
          log: string(6_000),
        }),
      }),
      empty,
    ),
  ],
]);
