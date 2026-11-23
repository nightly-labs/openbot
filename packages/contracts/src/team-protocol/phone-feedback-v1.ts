import { isString } from "../runtime-values";
import { type AdminDecoder, adminRoute, empty, fields, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const PHONE_FEEDBACK_CAPABILITY = "phone-feedback-v1";

export const PHONE_FEEDBACK_ROUTES = {
  send: "/v1/agent-approvals/send-phone-feedback",
} as const;

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
