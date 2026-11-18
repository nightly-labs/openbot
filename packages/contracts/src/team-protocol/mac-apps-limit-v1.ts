// Frozen optional mac-apps-limit-v1 marker.
//
// What it grants, recorded here because freezing it makes it permanent: nothing new on the wire. A
// host advertises it only when it does not run on macOS, so it cannot run a Marketplace app that drives
// Apple apps (`macAutomation` in the plugin catalog). A client then shows that such an app needs a Mac
// and does not offer to connect it. A host without it, older or on macOS, keeps every app available.
export const MAC_APPS_LIMIT_CAPABILITY = "mac-apps-limit-v1";
