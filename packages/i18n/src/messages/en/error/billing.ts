import { defineMessages } from "../../../message";

export const messages = defineMessages("error.billing", {
  "error.billing.lifecycleFailed": "The server plan could not be changed. Refresh Billing and try again.",
  "error.billing.confirmMismatch": "Type the server name to delete it.",
  "error.billing.restartBusy": "The server cannot restart now. Try again in a minute.",
  "error.billing.planRequired": "The plan of this server ended. Renew it to start the server.",
  "error.billing.planSoldOut": "This plan is sold out. Choose another plan.",
  // License errors.
  "error.billing.licenseExists": "This account already has a license. Change its users instead.",
  "error.billing.licenseCurrency": "The license must use the currency of your other plans.",
  "error.billing.planCurrency": "A new plan must use the currency of your other plans.",
  "error.billing.licenseUsersInUse": "The license cannot have fewer users than the people who use it now.",
  "error.billing.licensePaymentFailed":
    "The payment for the added users failed. Update the payment method and try again.",
  "error.billing.licenseUnavailable": "Licenses are not available now.",
  "error.billing.licenseOneUser": "This license is for 1 user. Change it to Team to add users.",
  "error.billing.licensePlanChange": "This license cannot change to that plan. Cancel it and buy the new plan.",
  "error.billing.noLicense": "This account has no license.",
  // Billing errors that the desktop and web clients make.
  "error.billing.invalidRequest": "The billing request is invalid.",
  "error.billing.invalidResponse": "The billing response is invalid.",
  "error.billing.notStripePage": "The billing page is not a Stripe page.",
});
