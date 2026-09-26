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
  "error.import.chooseZip": "Choose a .zip file.",
  "error.import.zipTooLarge": "The export must be a .zip under 500 MB.",
  "error.import.unsafeFile": "The export contains an unsafe file: {name}",
  "error.import.expandedTooLarge": "The export must expand to under 500 MB and {limit} files.",
  "error.import.zipInvalid":
    "The selected file is not a valid .zip. If Grok Bot is still saving it, wait and choose it again.",
  "error.import.empty": "The export is empty.",
});
