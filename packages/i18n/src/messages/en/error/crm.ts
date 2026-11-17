import { defineMessages } from "../../../message";

/** Errors that the CRM service and the agent CRM tools send. */
export const messages = defineMessages("error.crm", {
  "error.crm.serverTooOld": "This server does not support the CRM. Update OpenBot on the computer that runs it.",
  "error.crm.tooLargeToSend": "This CRM page is too large to send to this client.",
  "error.crm.customerMissing": "This customer no longer exists.",
  "error.crm.planMissing": "This plan no longer exists.",
  "error.crm.paymentMissing": "This payment no longer exists.",
  "error.crm.tagMissing": "This tag no longer exists.",
  "error.crm.statusMissing": "This status no longer exists.",
  "error.crm.proposalMissing": "This suggestion no longer exists or was already decided.",
  "error.crm.tagExists": "A tag with this name already exists.",
  "error.crm.statusExists": "A status with this name already exists.",
  "error.crm.builtinStatus": "You cannot rename or delete a built-in status.",
  "error.crm.tooManyStatuses": "The CRM has the maximum number of statuses. Delete a status first.",
  "error.crm.tooManyTags": "The CRM has the maximum number of tags. Delete a tag first.",
  "error.crm.tooManyPlans": "This customer has the maximum number of plans. Delete a plan first.",
  "error.crm.paymentPaid": "This payment is paid. Mark it as not paid first.",
  "error.crm.splitTotal": "The parts must add up to the amount of the payment.",
  "error.crm.planEndsBeforeStart": "A plan cannot end before it starts.",
  "error.crm.currencyInUse": "You cannot change the currency of a customer that has plans or payments.",
  "error.crm.badCursor": "This page is no longer valid. Load the list again.",
  "error.crm.invalidChange": "This change is not valid.",
  "error.crm.agentNotAllowed":
    "This agent cannot use the CRM. An owner or admin can let it in: open the CRM page, click Suggestions, click the button with the number of agents, and turn on this agent.",
  "error.crm.tooManyProposals":
    "There are too many suggestions that wait for a decision. Wait until a person decides them.",
  "error.crm.amountInvalid": "Write the amount as a number, such as 129.00.",
  "error.crm.amountDecimals": "The amount has too many decimal places for {currency}.",
  "error.crm.fieldPrivate": "This field is private. Agents cannot read it or filter by it.",
  "error.crm.sourceOwned": "Stripe keeps this row. Change it in Stripe; the CRM gets the change at the next sync.",
  "error.crm.sourceConnected": "Stripe is already connected to this CRM.",
  "error.crm.sourceMissing": "This Stripe connection no longer exists.",
  "error.crm.sourceSecretKey":
    "This is a secret key, which can change your Stripe account. Make a restricted key with read access only.",
  "error.crm.sourceInvalidKey": "Stripe does not accept this key. Copy the restricted key again.",
  "error.crm.sourcePermission":
    "This key cannot read customers, invoices, subscriptions, events and products. Give it read access to them.",
  "error.crm.sourceRateLimited": "Stripe got too many requests. Try again in a minute.",
  "error.crm.sourceNetwork": "OpenBot cannot connect to Stripe. Check the internet connection.",
  "error.crm.sourceFailed": "Stripe sent an answer that OpenBot cannot read. Try again later.",
  "error.crm.sourceKeySaveFailed": "OpenBot cannot save the Stripe key on this computer.",
  "error.crm.off": "The CRM is off. An owner or admin can turn it on in Server Settings > Experimental.",
  "error.crm.settingsSaveFailed": "OpenBot cannot save the CRM setting on this server.",
});
