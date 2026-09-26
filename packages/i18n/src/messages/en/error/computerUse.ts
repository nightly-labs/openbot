import { defineMessages } from "../../../message";

export const messages = defineMessages("error.computerUse", {
  // Computer Use driver and permission window errors.
  "error.computerUse.noAppToDrag": "This build of OpenBot has no application to drag.",
  "error.computerUse.helpWindowChanged": "The permission help window changed before the drag started.",
  "error.computerUse.noAppToShow": "This build of OpenBot has no application to show.",
  "error.computerUse.noDriver": "This computer has no Computer Use driver.",
  "error.computerUse.socketPathTooLong":
    "The Computer Use socket path is {length} characters, and this system allows {limit}.",
  "error.computerUse.socketDirectoryNotDirectory": "The Computer Use socket directory {path} is not a directory.",
  "error.computerUse.socketDirectoryOtherOwner": "The Computer Use socket directory {path} belongs to another user.",
  "error.computerUse.socketDirectoryShared": "The Computer Use socket directory {path} is open to other users.",
  "error.computerUse.socketNotReady": "It did not accept a connection in {seconds} seconds. {reason}",
});
