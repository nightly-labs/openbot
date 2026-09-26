import { defineMessages } from "../../message";

export const messages = defineMessages("agentSettings", {
  "agentSettings.label": "Agent settings",
  "agentSettings.title": "Settings",
  "agentSettings.backToDetails": "Back to details",
  "agentSettings.closeDetails": "Close details",
  "agentSettings.saveFailed": "Could not save agent settings.",

  "agentSettings.name": "Name",
  "agentSettings.nameLabel": "Agent name",
  "agentSettings.agentTitle": "Title",
  "agentSettings.agentTitleLabel": "Agent title",
  "agentSettings.agentTitlePlaceholder": "Describe what your agent does",
  "agentSettings.instructions": "Instructions",
  "agentSettings.instructionsLabel": "Agent instructions",
  "agentSettings.instructionsPlaceholder": "What this agent is for",

  "agentSettings.avatar.edit": "Edit agent avatar",
  "agentSettings.avatar.editor": "Avatar editor",
  "agentSettings.avatar.attachFiles": "Attach files",
  "agentSettings.avatar.image": "Image",
  "agentSettings.avatar.replaceImage": "Replace image",
  "agentSettings.avatar.uploadImage": "Upload image",
  "agentSettings.avatar.imageHint": "PNG, JPEG or WebP · square crop",
  "agentSettings.avatar.generatedFace": "Generated face",
  "agentSettings.avatar.resetToId": "Reset to ID",
  "agentSettings.avatar.newSet": "New set",
  "agentSettings.avatar.faces": "Generated avatar faces",
  "agentSettings.avatar.selected": "Selected avatar",
  "agentSettings.avatar.option": "Avatar option {number}",
  "agentSettings.avatar.color": "Color",
  "agentSettings.avatar.colorLabel": "Avatar color",
  "agentSettings.avatar.autoColor": "Automatic avatar color",
  "agentSettings.avatar.autoInitial": "A",
  "agentSettings.avatar.hueColor": "{hue} avatar color",
  "agentSettings.avatar.saveFailed": "Could not save the agent avatar.",
  "agentSettings.avatar.processFailed": "Could not process the agent avatar.",

  "agentSettings.runtime.title": "Runtime",
  "agentSettings.runtime.model": "Agent model",
  "agentSettings.runtime.modelBusy": "Wait for the current work to finish before changing models.",
  "agentSettings.runtime.modelUnavailable": "Models are available after an agent CLI connects.",
  "agentSettings.runtime.reasoning": "Reasoning",
  "agentSettings.runtime.reasoningLabel": "Agent reasoning level",
  "agentSettings.runtime.selectReasoning": "Select reasoning",
  "agentSettings.runtime.access": "Access",
  "agentSettings.runtime.accessLabel": "Agent access",
  "agentSettings.runtime.workingDirectory": "Working directory",
  "agentSettings.runtime.notAvailable": "Not available yet",
  "agentSettings.runtime.fullAccessNote":
    "The agent runs with full computer access from its workspace and the shared folder.",
  "agentSettings.runtime.claudeApprovalNote":
    "Claude acts without asking for approval, except for questions it puts to you.",
  "agentSettings.runtime.providerApprovalNote":
    "Depending on the provider, sensitive commands may ask for approval first.",

  "agentSettings.access.workspace": "Workspace only",
  "agentSettings.access.full": "Full access",

  "agentSettings.notifications.title": "Notifications",
  "agentSettings.notifications.description": "Get notified when this agent finishes or needs input",

  "agentSettings.fullAccess.title": "Give this agent full access?",
  "agentSettings.fullAccess.description":
    "The agent can then read, change and delete any file your user account can reach, run any command, and use the network. One misunderstood instruction or a malicious web page can reach your personal files.",
  "agentSettings.fullAccess.cancel": "Keep workspace only",
  "agentSettings.fullAccess.confirm": "Allow full access",

  "agentSettings.links.usage": "Usage",
  "agentSettings.links.memories": "Memories",
  "agentSettings.links.memoriesCount": { one: "{count} saved", other: "{count} saved" },
  "agentSettings.links.skills": "Skills",
  "agentSettings.links.skillsCount": { one: "{count} assigned", other: "{count} assigned" },
  "agentSettings.links.tables": "Tables",
  "agentSettings.links.tablesCount": { one: "{count} table", other: "{count} tables" },
  "agentSettings.links.files": "Files",
  "agentSettings.links.routines": "Routines",
  "agentSettings.links.routinesCount": { one: "{count} configured", other: "{count} configured" },
  "agentSettings.runtime.workspaceNote":
    "Workspace only limits writes to this agent's workspace, the shared folder and the temporary folders. Reads and network stay available.",
  "agentSettings.runtime.workspaceNotEnforced":
    "{provider} does not enforce it yet, so this agent still has full access. Codex and Claude agents are enforced.",
  "agentSettings.runtime.workspaceEnforcedCommand":
    "A command that must write outside asks you first, also when Auto approve is on.",
  "agentSettings.runtime.workspaceEnforcedClaude":
    "A file edit outside asks you first, also when Auto approve is on. A command cannot write outside.",
  "agentSettings.runtime.workspaceUnlimited":
    "Computer Use and the OpenBot browser are not limited; you can turn Computer Use off below.",
  "agentSettings.computerUse.title": "Computer Use",
  "agentSettings.computerUse.description": "Let this agent control apps on this computer",
});
