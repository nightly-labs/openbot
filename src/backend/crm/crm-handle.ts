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

export class CrmError extends Schema.TaggedError<CrmError>()("CrmError", {
  code: Schema.Literals(["missing", "refused"]),
  message: Schema.String,
}) {}

export interface CrmPeopleOperations {
  overview(): Effect.Effect<CrmOverview, CrmError>;
  customers(input: CrmCustomerPageInput): Effect.Effect<CrmCustomerPage, CrmError>;
  payments(input: CrmPaymentPageInput): Effect.Effect<CrmPaymentPage, CrmError>;
  activity(input: CrmActivityPageInput): Effect.Effect<CrmActivityPage, CrmError>;
  apply(change: CrmChange, actor: CrmActor): Effect.Effect<CrmApplyResult, CrmError>;
  sourceConnect(input: CrmSourceConnectInput): Effect.Effect<CrmApplyResult, CrmError>;
  sourceDisconnect(input: CrmSourceInput): Effect.Effect<CrmApplyResult, CrmError>;
  sourceSync(input: CrmSourceInput): Effect.Effect<CrmApplyResult, CrmError>;
  settings(): Effect.Effect<CrmSettings, CrmError>;
  setSettings(settings: CrmSettings): Effect.Effect<CrmSettings, CrmError>;
}

export interface CrmSettingsStore {
  get(): CrmSettings;
  set(settings: CrmSettings): Effect.Effect<CrmSettings, CrmError>;
}
