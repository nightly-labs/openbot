import { defineMessages } from "../../../message";

export const messages = defineMessages("error.vault", {
  // The Vault of this computer: its encrypted file and the items that the user saves in it.
  "error.vault.unavailable": "This computer has no secret storage, so the Vault cannot save items.",
  "error.vault.unreadable": "The Vault file is unreadable. Reset the Vault to use it again.",
  "error.vault.tooLarge": "The Vault is full. Delete some items, then try again.",
  "error.vault.itemMissing": "This item is no longer in the Vault.",
  "error.vault.valueTooLong": "A value is too long.",
  "error.vault.websiteInvalid": "Enter an HTTPS website address.",
  "error.vault.passwordRequired": "Enter a password.",
  "error.vault.cardNumberInvalid": "Enter a valid card number.",
  "error.vault.securityCodeInvalid": "Enter a security code of 3 or 4 digits.",
  "error.vault.expiryInvalid": "Enter a valid expiry month and year.",
  "error.vault.contactEmpty": "Enter a name, an address, a phone number or an email address.",
  "error.vault.contactMissing": "The billing contact is no longer in the Vault.",
  "error.vault.apiKeyRequired": "Enter an API key.",
  "error.vault.apiKeyNameInvalid":
    "Enter a variable name with capital letters A–Z, digits and _, which starts with a letter, such as OPENAI_API_KEY.",
  "error.vault.apiKeyNameTaken": "The Vault has an API key with this variable name already.",
  "error.vault.csvInvalid": "This file is not a password export in CSV format.",
  "error.vault.csvTooLarge": "The CSV file is too large.",
});
