import { defineMessages } from "../../../message";

export const messages = defineMessages("error.billing", {
  "error.billing.lifecycleFailed": "The server plan could not be changed. Refresh Billing and try again.",
  "error.billing.confirmMismatch": "Type the server name to delete it.",
  // Billing errors that the desktop and web clients make.
  "error.billing.invalidRequest": "The billing request is invalid.",
  "error.billing.invalidResponse": "The billing response is invalid.",
  "error.billing.notStripePage": "The billing page is not a Stripe page.",
});
