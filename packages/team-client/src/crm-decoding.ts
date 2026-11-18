// CRM payloads from a joined server, for the desktop app, the web client and the mobile app.
// `crm-v1` carries activity kinds as open names, and the IPC guard already accepts any well-formed
// kind, so a newer host can add one without a mapping here.

import {
  isCrmActivityPage,
  isCrmApplyResult,
  isCrmCustomerPage,
  isCrmOverview,
  isCrmPaymentPage,
  isCrmSettings,
} from "@openbot/contracts/ipc";
import { guardedDecoder } from "@openbot/contracts/ipc-decoding";

export const decodeRemoteCrmOverview = guardedDecoder(isCrmOverview, "remote CRM overview");
export const decodeRemoteCrmCustomerPage = guardedDecoder(isCrmCustomerPage, "remote CRM customers");
export const decodeRemoteCrmPaymentPage = guardedDecoder(isCrmPaymentPage, "remote CRM payments");
export const decodeRemoteCrmActivityPage = guardedDecoder(isCrmActivityPage, "remote CRM activity");
export const decodeRemoteCrmApplyResult = guardedDecoder(isCrmApplyResult, "remote CRM change result");
export const decodeRemoteCrmSettings = guardedDecoder(isCrmSettings, "remote CRM settings");
