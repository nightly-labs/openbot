// The two failure kinds a Team API call produces, and the difference between them.
//
// `RemoteRequestError` is the host answering: it understood the request and refused it, so `status`
// and `code` are the host's own words and the connection is still good. `RemoteProtocolError` is the
// host and this app disagreeing about the wire itself -- an unreadable body, or a protocol range with
// no overlap -- which no retry fixes and which pauses the event stream.
//
// `remote-server-connection-status.ts` is the only place that turns either into something a user
// sees. Both are classified by `instanceof`, so this file must stay their single definition: a second
// copy of a class makes every `instanceof` silently false.

import type { TeamProtocolSupportV1 } from "@openbot/contracts/team-protocol/v1";
import { Schema } from "effect";

export class RemoteRequestError extends Schema.TaggedError<RemoteRequestError>()("RemoteRequestError", {
  status: Schema.Number,
  code: Schema.NullOr(Schema.String),
  message: Schema.String,
}) {
  constructor(status: number, message: string, code: string | null = null) {
    super({ status, message, code });
  }
}

export class RemoteProtocolError extends Schema.TaggedError<RemoteProtocolError>()("RemoteProtocolError", {
  code: Schema.Literals(["client_update_required", "host_update_required", "protocol_error"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  readonly support: TeamProtocolSupportV1 | null;
  constructor(
    code: "client_update_required" | "host_update_required" | "protocol_error",
    message: string,
    support: TeamProtocolSupportV1 | null = null,
    options?: ErrorOptions,
  ) {
    super({ code, message, cause: options?.cause });
    this.support = support;
  }
}
