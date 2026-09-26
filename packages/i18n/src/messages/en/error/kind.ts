import { defineMessages } from "../../../message";

/** The sentence for each kind `classifyUserError` decides. `@openbot/user-errors` owns the mapping. */
export const messages = defineMessages("error.kind", {
  "error.kind.network": "Could not connect. Check your connection and try again.",
  "error.kind.timeout": "The request took too long. Check whether the action completed before you try again.",
  "error.kind.storage":
    "There is not enough storage space. Free some space on the computer running OpenBot, then try again.",
  "error.kind.filePermission":
    "OpenBot does not have permission to complete this action. Check the file or folder permissions, then try again.",
  "error.kind.notFound":
    "A required file or folder could not be found. Restore it or choose another one, then try again.",
  "error.kind.readOnly": "This folder is read-only. Choose a folder you can write to, then try again.",
  "error.kind.conflict": "An item with this name already exists. Choose a different name, then try again.",
  "error.kind.auth": "Authentication failed. Check your account or server connection, then try again.",
  "error.kind.permission": "You do not have permission to complete this action. Ask the owner for access.",
  "error.kind.rateLimit": "Too many requests. Wait a moment, then try again.",
  "error.kind.service": "The service is unavailable. Wait a moment, then try again.",
});
