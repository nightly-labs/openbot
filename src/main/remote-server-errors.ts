import type { TeamProtocolSupportV1 } from "@openbot/contracts/team-protocol/v1";
import { Schema } from "effect";

export class RemoteRequestError extends Schema.TaggedError<RemoteRequestError>()("RemoteRequestError", {
  status: Schema.Number,
  code: Schema.NullOr(Schema.String),
  message: Schema.String,
  reference: Schema.NullOr(Schema.String),
}) {
  constructor(status: number, message: string, code: string | null = null, reference: string | null = null) {
    super({ status, message, code, reference });
  }
}

export class RemoteProtocolError extends Schema.TaggedError<RemoteProtocolError>()("RemoteProtocolError", {
  code: Schema.Literals(["client_update_required", "host_update_required", "protocol_error", "server_safe_mode"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  readonly support: TeamProtocolSupportV1 | null;
  constructor(
    code: "client_update_required" | "host_update_required" | "protocol_error" | "server_safe_mode",
    message: string,
    support: TeamProtocolSupportV1 | null = null,
    options?: ErrorOptions,
  ) {
    super({ code, message, cause: options?.cause });
    this.support = support;
  }
}
