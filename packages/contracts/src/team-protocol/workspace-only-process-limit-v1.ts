// Frozen optional workspace-only-process-limit-v1 marker.
//
// What it grants, recorded here because freezing it makes it permanent: nothing new on the wire. A
// host advertises it only when it cannot run a `confined-process` provider (`workspaceEnforcement` in
// `agent-providers.ts`) with Workspace only, as on Windows and Linux. Such a host refuses a Workspace
// only agent's move to such a provider, so a client shows those models as unavailable for that agent.
// A host without it, older or able to confine the process, keeps every model available.
export const WORKSPACE_ONLY_PROCESS_LIMIT_CAPABILITY = "workspace-only-process-limit-v1";
