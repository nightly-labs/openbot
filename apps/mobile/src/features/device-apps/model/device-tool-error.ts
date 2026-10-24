import type { DeviceToolErrorCode } from "@openbot/contracts/team-protocol/device-tools-v1";

/** A refusal or failure with one of the four codes that the answer to the host can carry. */
export class DeviceToolError extends Error {
  readonly code: DeviceToolErrorCode;

  constructor(code: DeviceToolErrorCode) {
    super(code);
    this.code = code;
  }
}
