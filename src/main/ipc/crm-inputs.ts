import {
  type CrmActivityPageInput,
  type CrmChange,
  type CrmCustomerPageInput,
  type CrmPaymentPageInput,
  type CrmSettings,
  type CrmSourceConnectInput,
  type CrmSourceInput,
  isCrmActivityPageInput,
  isCrmChange,
  isCrmCustomerPageInput,
  isCrmPaymentPageInput,
  isCrmSettings,
  isCrmSourceConnectInput,
  isCrmSourceInput,
} from "@openbot/contracts/ipc";
import { registerSecretValue } from "@openbot/logging";

export function parseCrmCustomerPage(value: unknown): CrmCustomerPageInput {
  if (!isCrmCustomerPageInput(value)) throw new Error("Invalid CRM customers request.");
  return value;
}

export function parseCrmPaymentPage(value: unknown): CrmPaymentPageInput {
  if (!isCrmPaymentPageInput(value)) throw new Error("Invalid CRM payments request.");
  return value;
}

export function parseCrmActivityPage(value: unknown): CrmActivityPageInput {
  if (!isCrmActivityPageInput(value)) throw new Error("Invalid CRM activity request.");
  return value;
}

export function parseCrmSourceConnect(value: unknown): CrmSourceConnectInput {
  if (!isCrmSourceConnectInput(value)) throw new Error("Invalid CRM source connect request.");
  registerSecretValue(value.key);
  return value;
}

export function parseCrmSource(value: unknown): CrmSourceInput {
  if (!isCrmSourceInput(value)) throw new Error("Invalid CRM source request.");
  return value;
}

export function parseCrmSettings(value: unknown): CrmSettings {
  if (!isCrmSettings(value)) throw new Error("Invalid CRM settings.");
  return value;
}

export function parseCrmChange(value: unknown): CrmChange {
  if (!isCrmChange(value)) throw new Error("Invalid CRM change.");
  return value;
}
