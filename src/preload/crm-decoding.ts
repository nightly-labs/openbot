// What main answers for the CRM: the overview, the pages of customers, payments and activity, and the
// result of a change.

import {
  isCrmActivityPage,
  isCrmApplyResult,
  isCrmCustomerPage,
  isCrmOverview,
  isCrmPaymentPage,
  isCrmSettings,
} from "@openbot/contracts/ipc";
import { guardedDecoder } from "@openbot/contracts/ipc-decoding";

export const decodeCrmOverview = guardedDecoder(isCrmOverview, "CRM overview response");
export const decodeCrmCustomerPage = guardedDecoder(isCrmCustomerPage, "CRM customers response");
export const decodeCrmPaymentPage = guardedDecoder(isCrmPaymentPage, "CRM payments response");
export const decodeCrmActivityPage = guardedDecoder(isCrmActivityPage, "CRM activity response");
export const decodeCrmApplyResult = guardedDecoder(isCrmApplyResult, "CRM change response");
export const decodeCrmSettings = guardedDecoder(isCrmSettings, "CRM settings response");
