import { defineMessages } from "../../../message";

export const messages = defineMessages("error.import", {
  // Agent import errors and warnings.
  "error.import.manifestNotJson": "{manifest} is not valid JSON.",
  "error.import.notAgentExport": "{manifest} is not an OpenBot agent export.",
  "error.import.newerExportSkill": "This export was made by a newer export skill. Update OpenBot and try again.",
  "error.import.noAgents": "The export contains no agents.",
  "error.import.tooManyAgents": "The export contains more than {limit} agents.",
  "error.import.tooManyChannels": "The export contains more than {limit} channels.",
  "error.import.channelSkipped": "{name}: the channel is skipped because none of its agents are in the export.",
  "error.import.membersLeftOut": "{name}: members that are not agents in this export are left out.",
  "error.import.leadNotMember": "{name}: the lead is not a member, so the channel has no lead.",
  "error.import.routineLimit": "{name}: only the first {limit} routines are imported.",
  "error.import.routineInvalid":
    '{name}: routine "{routine}" is skipped because its name, text, or schedule is invalid.',
  "error.import.memoriesSkipped":
    "{name}: {skipped} memories are skipped because they are empty or longer than {limit} characters.",
  "error.import.memoryLimit": "{name}: only the first {limit} memories are imported.",
  "error.import.manifestMissing": "The export must contain {manifest}.",
  "error.import.skillFolderMissing": "{name}: the skill folder {skill} has no SKILL.md.",
  "error.import.avatarSkipped": "{name}: the avatar is skipped because it is not a PNG, JPEG, or WebP under 512 KB.",
  "error.import.exportClosed": "The export is no longer open. Choose it again.",
  "error.import.agentNotInExport": "The selection names an agent that is not in the export.",
  "error.import.channelNotInExport": "The selection names a channel that is not in the export.",
  "error.import.serverAgentLimit": "A server can have at most {limit} agents.",
  "error.import.exportChanged": "The export changed after it was checked. Choose it again.",
  "error.import.noMembersImported": "None of its agents were imported.",
  "error.import.leadNotImported": "{name}: its lead was not imported, so it has no lead.",
  "error.import.routineSkipped": '{name}: routine "{routine}" is skipped. {reason}',
  "error.import.fileRenamed": "{name}: {file} already exists, so this copy is saved as {saved}.",
  "error.import.fileSkipped": "{name}: the file {file} is skipped. {reason}",
  "error.import.chooseZip": "Choose a .zip file.",
  "error.import.unsafeFile": "The export contains an unsafe file: {name}",
  "error.import.tooManyFiles": "The export must have {limit} files or fewer.",
  "error.import.diskSpace":
    "{name}: its files need {size} GB of free disk space, and {free} GB is free. Free up space, then import the agent again.",
  "error.import.remoteExpandedTooLarge": "The export must expand to under 500 MB and {limit} files.",
  "error.import.zipInvalid":
    "The selected file is not a valid .zip. If Grok Bot is still saving it, wait and choose it again.",
  "error.import.entryDamaged": "The file is damaged in the export.",
  "error.import.foldersSkipped":
    "{number} files in .git and node_modules folders are left out. A tool can make them again.",
  "error.import.empty": "The export is empty.",
  "error.import.remoteZipTooLarge": "To import into a joined server, the export must be a .zip under 100 MB.",
  "error.import.hostBusy": "The server is reading other exports. Try again in a few minutes.",
  "error.import.uploadDiskSpace":
    "The export needs {size} GB of free disk space on the server, and {free} GB is free. Free up space on the server, then choose the export again.",
  "error.import.remoteZipTooLargeOldHost":
    "This server accepts an export of up to 100 MB. Update OpenBot on the server to import a larger export.",
  "error.import.skillKept":
    '{name}: the server already has the skill "{skill}", so the agent uses that skill. Ask an admin to update it.',
  "error.import.skillRenamed":
    '{name}: the name of the skill "{skill}" is too similar to the name of another skill, so it is saved as "{renamed}".',
  // Hermes Agent import from a folder on this computer.
  "error.import.hermesNoProfiles":
    "This folder has no Hermes profiles. Choose the Hermes folder, which holds config.yaml or SOUL.md.",
  "error.import.hermesClosed": "The Hermes profiles are no longer open. Read them again.",
  "error.import.hermesProfileMissing": "The selection names a Hermes profile that was not read.",
  "error.import.hermesSoulLong":
    "{name}: SOUL.md is longer than {limit} characters, so the instructions keep its start. The full file is in imported/hermes/SOUL.md.",
  "error.import.hermesSkillSkipped": '{name}: the skill "{skill}" is skipped. {reason}',
  "error.import.hermesSkillCodeAdded":
    "It has code that it did not have when the profiles were read. Read them again to allow it.",
  "error.import.hermesLinkNotSaved":
    "{name}: OpenBot could not save which agent came from this profile, so the next import adds it as a new agent.",
  // Instance transfer between two OpenBot computers.
  "error.import.transferRemoteTooLarge":
    "A transfer file for a joined server must be under 100 MB. Turn off workspace files, or export fewer agents.",
  "error.import.transferNotFile": "This file is not an OpenBot transfer file.",
  "error.import.transferNewer": "A newer version of OpenBot made this file. Update OpenBot and try again.",
  "error.import.transferEmpty": "The file contains no agents and no settings.",
  "error.import.transferTooLarge":
    "A transfer file must be under 2 GB and 50,000 files. Turn off workspace files, or export fewer agents.",
  "error.import.transferAgentInvalid": "Agent {number} in the file is invalid, so it is skipped.",
  "error.import.transferSettingsInvalid": "The app settings in the file are invalid, so they are not imported.",
  "error.import.transferModelMissing":
    '{name}: the model "{model}" is not available here yet, so the agent uses the default model. Choose the model again when its provider is ready.',
  "error.import.transferAgentSettingSkipped": "{name}: a setting of the agent is not applied. {reason}",
  "error.import.transferChannelInstructionsCut":
    "{name}: only the first {limit} characters of the channel instructions are in the file, because a new channel can have {limit}.",
  "error.import.transferSettingSkipped": "{name} is not imported. {reason}",
  "error.import.transferRoutineFlowSkipped": "The import left out a routine flow. {reason}",
  "error.import.transferCustomAgentCommand":
    '{name}: custom agents are not imported, because they run a command. Check the command "{command}" and add the agent again in Settings.',
  "error.import.transferSkillLimit":
    "{name}: only the first {limit} of its {total} skills are in the file, because an agent can have {limit} skills.",
  "error.import.transferFilesGone": "{number} files were deleted while the export ran, so they are not in the file.",
  "error.import.transferProviderKey": "{name}: enter its API key again in Settings.",
  "error.import.transferAgentEnv": "{name}: enter the values of {names} again in Settings.",
  "error.import.transferMcpValues":
    "{name}: the MCP server is added turned off. Check its command, enter its values and full address again, and turn it on in MCP settings.",
  "error.import.transferValuesCleared":
    "{name}: values that can hold a secret were removed from its arguments or address. Enter them again in Settings.",
  "error.import.transferSharedKept":
    "{number} files in the Shared folder are already here, so they are kept as they are.",
  "error.import.transferChannelInvalid": "Channel {number} in the file is invalid, so it is skipped.",
  "error.import.transferChannelLimit": "Only the first {limit} channels are in the file.",
  "error.import.transferWorkflowInvalid": "A workflow in the file is invalid, so it is skipped.",
  "error.import.transferRoutineWebhook":
    "{name}: the routine “{routine}” has a new webhook address. Open it, make a new secret, and give both to the sender.",
  "error.import.transferWorkflowWebhook":
    "{name}: the workflow needs a new webhook address. Open it, make the address again, and give it to the sender.",
  "error.import.transferWorkflowConnection":
    "{name}: choose the Slack, Discord, or Telegram connection of the workflow again after you connect it here.",
  "error.import.transferHistorySkipped": "{name}: the chat history in the file is invalid, so it is not imported.",
  "error.import.transferChatsSkipped": {
    one: "{name}: {count} chat is not imported.",
    other: "{name}: {count} chats are not imported.",
  },
  "error.import.transferLocalScripts":
    "{name}: “Local scripts” was on for this agent. Turn it on again in its settings if you trust the file.",
  "error.import.transferAgentNewChats":
    "{name}: “Agent starts new chats” was on for this agent. Turn it on again in its settings if you trust the file.",
  "error.import.transferAlwaysAllow":
    "{name}: you always allowed this agent on the other computer. Here it asks first until you allow it again.",
  "error.import.transferFolders":
    "{name}: it used {number} folders outside its workspace. Add them again in its settings, in Folders.",
  // A transfer file that goes to or from a joined server in parts.
  "error.import.transferPartsClosed": "The transfer with the server stopped. Try again.",
  "error.import.transferPartInvalid": "Part of the transfer file did not arrive correctly. Try again.",
  "error.import.transferStepFailed": "This server did not save it.",
  "error.import.transferNoSpace": "There is not enough free disk space on the server for this transfer file.",
});
