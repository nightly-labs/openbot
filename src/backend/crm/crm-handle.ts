import type {
  CrmActivityPage,
  CrmActivityPageInput,
  CrmActor,
  CrmApplyResult,
  CrmChange,
  CrmCustomerPage,
  CrmCustomerPageInput,
  CrmOverview,
  CrmPaymentPage,
  CrmPaymentPageInput,
  CrmSettings,
  CrmSourceConnectInput,
  CrmSourceInput,
} from "@openbot/contracts/ipc";
import { type Effect, Schema } from "effect";

/**
 * A refusal the user reads: the message is already a sentence for them (`sourceText`). `missing`
 * says there is no such customer, plan, payment, tag, status or proposal, so a client shows it as
 * gone; `refused` is a valid request that the CRM cannot do, such as a duplicate tag.
 */
export class CrmError extends Schema.TaggedError<CrmError>()("CrmError", {
  code: Schema.Literals(["missing", "refused"]),
  message: Schema.String,
}) {}

/** The CRM operations that the IPC handlers and the Team API route call. */
export interface CrmPeopleOperations {
  overview(): Effect.Effect<CrmOverview, CrmError>;
  customers(input: CrmCustomerPageInput): Effect.Effect<CrmCustomerPage, CrmError>;
  payments(input: CrmPaymentPageInput): Effect.Effect<CrmPaymentPage, CrmError>;
  activity(input: CrmActivityPageInput): Effect.Effect<CrmActivityPage, CrmError>;
  /** One change by an owner or admin. `actor.kind` is always "person". */
  apply(change: CrmChange, actor: CrmActor): Effect.Effect<CrmApplyResult, CrmError>;
  /** Checks and saves a read-only key, then starts the first sync. The key never comes back. */
  sourceConnect(input: CrmSourceConnectInput): Effect.Effect<CrmApplyResult, CrmError>;
  /** Deletes the key; the rows of the source stay and become editable. */
  sourceDisconnect(input: CrmSourceInput): Effect.Effect<CrmApplyResult, CrmError>;
  /** Starts a sync now and returns at once. */
  sourceSync(input: CrmSourceInput): Effect.Effect<CrmApplyResult, CrmError>;
  /** The CRM switch of Server Settings > Experimental. */
  settings(): Effect.Effect<CrmSettings, CrmError>;
  /** Turns the CRM on or off. The data stays; agents and the payment sources stop while it is off. */
  setSettings(settings: CrmSettings): Effect.Effect<CrmSettings, CrmError>;
}

/** Where main keeps the CRM switch. */
export interface CrmSettingsStore {
  get(): CrmSettings;
  set(settings: CrmSettings): Effect.Effect<CrmSettings, CrmError>;
}
