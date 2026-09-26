import { defineMessages } from "../../../message";

export const messages = defineMessages("error.host", {
  // Errors from host setup, publishing, and host maintenance.
  "error.host.iceServersMissing": "Remote Signal has not supplied ICE servers.",
  "error.host.webRtcNotConfigured": "The WebRTC host service is not configured.",
  "error.host.runtimeNotInstalled": "The remote desktop runtime is not installed.",
  "error.host.setupUnavailable": "Permission setup is not available.",
  "error.host.accountChangedDuringUpdate": "The signed-in account changed while this server was being updated.",
  "error.host.nameBeforePublish": "Name this OpenBot before publishing it.",
  "error.host.memberNotFound": "The remote member does not exist.",
  "error.host.publishBeforeInvite": "Make this OpenBot public before creating an invite.",
  "error.host.teamAccessUnavailable": "Your team access is unavailable.",
  "error.host.ownerIdentityUnavailable": "The host owner identity is unavailable.",
  "error.host.reserveAddressFailed": "Could not reserve the public address.",
  "error.host.publishFailed": "This OpenBot could not be published.",
  "error.host.mobileConnectPublishFailed": "This OpenBot could not be published for Mobile Connect.",
  "error.host.mobileConnectHostChanged": "The Mobile Connect host changed. Try again.",
  "error.host.noServer": "This computer has no server to change.",
  "error.host.identityLocalOnly": "The server name and logo can only be changed on the computer that runs it.",
  "error.host.maintenanceInterrupted":
    "Interrupted host maintenance. Verify the application and reset host state before retrying.",
  "error.host.updateFailed":
    "Host update failed during {phase}. Verify bundle ownership, signing, tenant status and free disk space before resetting state.",
  "error.host.tenantsNotIdle": "Tenants did not remain idle for five minutes within two hours.",
  "error.host.tenantShutdownTimeout": "Tenant shutdown timed out. No application replacement was started.",
  "error.host.tenantHealthMissing":
    "Tenant health reports are missing or unhealthy after restart. Inspect tenant sessions before another update.",
});
