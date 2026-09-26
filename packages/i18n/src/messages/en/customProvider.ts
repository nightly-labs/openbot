import { defineMessages } from "../../message";

export const messages = defineMessages("customProvider", {
  // Form validation. Each message names one field of the custom provider form.
  "customProvider.error.providerIdRequired": "Enter a provider ID.",
  "customProvider.error.providerIdPattern":
    "Use lowercase letters, numbers, hyphens or underscores, starting with a letter or number.",
  "customProvider.error.providerIdLength": "Keep the provider ID under {max} characters.",
  "customProvider.error.providerIdBuiltIn": "OpenBot already has a provider called {id}. Choose another ID.",
  "customProvider.error.providerIdSaved":
    "An endpoint called {id} is already saved. Remove it first, or choose another ID.",
  "customProvider.error.displayNameRequired": "Enter a display name.",
  "customProvider.error.displayNameLength": "Keep the display name under {max} characters.",
  "customProvider.error.apiKeyLength": "Keep the API key under {max} characters.",
  "customProvider.error.modelsRequired": "Add at least one model.",
  "customProvider.error.modelsLimit": "Add no more than {max} models.",
  "customProvider.error.modelIdRequired": "Enter a model ID.",
  "customProvider.error.modelIdDuplicate": "This provider already lists {id}.",
  "customProvider.error.modelIdInvalid": "This model ID cannot be used. Remove spaces, quotes and other punctuation.",
  "customProvider.error.headerNameRequired": "Enter a header name.",
  "customProvider.error.headerNameInvalid": "Use a valid HTTP header name.",
  "customProvider.error.headerDuplicate": "This provider already sets {name}.",
  "customProvider.error.headerValueRequired": "Enter a header value.",
  "customProvider.error.headersLimit": "Add no more than {max} headers.",
  "customProvider.error.baseUrlRequired": "Enter a base URL.",
  "customProvider.error.baseUrlLength": "Keep the base URL under {max} characters.",
  "customProvider.error.baseUrlInvalid": "Enter a full URL, such as {example}.",
  "customProvider.error.baseUrlProtocol": "Use an http:// or https:// URL.",
  "customProvider.error.baseUrlCredential": "Put the credential in a header, not in the URL.",

  // The note after a save or a removal. It tells the user when OpenCode reads the new list.
  "customProvider.saved.restarted": "Saved. OpenBot is loading the models.",
  "customProvider.saved.skippedBusy":
    "Saved. OpenCode reads the list after the current task stops. Press Connect then.",
  "customProvider.saved.notRunning": "Saved. OpenCode reads the list when it next starts.",
  "customProvider.removed.restarted": "Removed. OpenBot is loading the models.",
  "customProvider.removed.skippedBusy":
    "Removed. OpenCode reads the list after the current task stops. Press Connect then.",
  "customProvider.removed.notRunning": "Removed. OpenCode reads the list when it next starts.",
  "customProvider.saveFailed": "OpenBot could not save this endpoint.",
  "customProvider.removeFailed": "OpenBot could not remove {name}.",
  "customProvider.saveUnavailable": "This build cannot save an endpoint.",
  "customProvider.removeUnavailable": "This build cannot remove an endpoint.",

  // The add dialog.
  "customProvider.form.title": "Add a custom provider",
  "customProvider.form.description": "Describe an OpenAI-compatible endpoint and the models it serves.",
  "customProvider.form.heading": "Custom provider",
  "customProvider.form.subtitle": "Any OpenAI-compatible endpoint.",
  "customProvider.field.providerId": "Provider ID",
  "customProvider.field.providerIdHint": "Lowercase letters, numbers, hyphens, or underscores.",
  "customProvider.field.displayName": "Display name",
  "customProvider.field.displayNamePlaceholder": "My Provider",
  "customProvider.field.baseUrl": "Base URL",
  "customProvider.field.apiKey": "API key",
  "customProvider.field.apiKeyHint": "Optional. Leave empty if you manage auth via headers.",
  "customProvider.models": "Models",
  "customProvider.model.id": "Model {number} ID",
  "customProvider.model.name": "Model {number} display name",
  "customProvider.model.namePlaceholder": "Display Name",
  "customProvider.model.remove": "Remove model {number}",
  "customProvider.model.add": "Add model",
  "customProvider.headers": "Headers",
  "customProvider.header.name": "Header {number} name",
  "customProvider.header.value": "Header {number} value",
  "customProvider.header.valuePlaceholder": "value",
  "customProvider.header.remove": "Remove header {number}",
  "customProvider.header.add": "Add header",
  "customProvider.submit": "Submit",

  // The list of saved endpoints.
  "customProvider.list.title": "Custom providers",
  "customProvider.list.description": "The endpoints you have saved. Remove the ones you no longer use.",
  "customProvider.list.subtitle": "Your own model endpoints.",
  "customProvider.list.empty": "No custom endpoints yet.",
  "customProvider.list.label": "Custom endpoints",
  "customProvider.list.apiKeySaved": "API key saved",
  "customProvider.list.deleteLabel": "Delete {name}",
  "customProvider.list.confirmTitle": "Remove {name}?",
  "customProvider.list.confirmDescription":
    "Its API key is discarded, its models disappear from the picker, and any agent using one falls back to a default model.",
});
