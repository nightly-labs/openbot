import { defineMessages } from "../../../message";

export const messages = defineMessages("status.computerUse", {
  // Computer Use driver status.
  "status.computerUse.driverNotStarted": "The Computer Use driver did not start. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "The Computer Use driver stopped before it could answer.",
  "status.computerUse.driverNoAnswer": "The Computer Use driver did not answer. {reason}",
  "status.computerUse.driverStopped": "The Computer Use driver stopped.",
  "status.computerUse.unsupported": "Computer Use is available on macOS, Windows and Linux.",
  "status.computerUse.driverMissing": "This build of OpenBot carries no Computer Use driver.",
});
