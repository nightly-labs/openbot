import { defineMessages } from "../../../message";

export const messages = defineMessages("error.marketplace", {
  // Agent marketplace and agent link errors.
  "error.marketplace.timezoneInvalid": "The local timezone is invalid.",
  "error.marketplace.installedAgentMissing": "The installed agent no longer exists.",
  "error.marketplace.differentListing": "This local agent was installed from a different marketplace agent.",
  "error.marketplace.marketplaceAvatarInvalid": "The marketplace agent avatar is invalid.",
  "error.marketplace.shareCardInvalid": "The share card is invalid.",
  "error.marketplace.cannotPublish": "This agent cannot be published.",
  "error.marketplace.templateName": {
    one: "Give this agent a name of 1 to {count} characters.",
    other: "Give this agent a name of 1 to {count} characters.",
  },
  "error.marketplace.templateRole": {
    one: "The role is longer than {count} characters. Shorten it.",
    other: "The role is longer than {count} characters. Shorten it.",
  },
  "error.marketplace.templateNoInstructions": "Add instructions to this agent before publishing it.",
  "error.marketplace.templateInstructions": {
    one: "The instructions are longer than {count} characters. Shorten them.",
    other: "The instructions are longer than {count} characters. Shorten them.",
  },
  "error.marketplace.templateAvatar": "The avatar of this agent is not valid. Choose it again in the agent settings.",
  "error.marketplace.templateSkills": {
    one: "An agent can publish up to {count} skills. Remove some of them.",
    other: "An agent can publish up to {count} skills. Remove some of them.",
  },
  "error.marketplace.templateLocalSkills": {
    one: "An agent can publish up to {count} local skills. Remove some of them.",
    other: "An agent can publish up to {count} local skills. Remove some of them.",
  },
  "error.marketplace.templateSkill": 'The skill "{name}" cannot be published. Check its name and its SKILL.md.',
  "error.marketplace.templateRoutines": {
    one: "An agent can publish up to {count} routines. Remove some of them.",
    other: "An agent can publish up to {count} routines. Remove some of them.",
  },
  "error.marketplace.templateRoutine": {
    one: 'The routine "{name}" needs a name of up to {count} characters and an instruction.',
    other: 'The routine "{name}" needs a name of up to {count} characters and an instruction.',
  },
  // Fills `{name}` above when the routine has no name.
  "error.marketplace.templateRoutineNoName": "without a name",
  "error.marketplace.templateTooLarge":
    "This agent is too large to publish. Shorten its instructions, skills or routines.",
  "error.marketplace.linkInvalid": "The agent link is invalid.",
  "error.marketplace.changedSinceOpened":
    "This agent changed after you opened it. Open the link again to review the new version.",
  "error.marketplace.skillNameConflict":
    'You already have a different local skill named "{name}". Rename or remove it, then add this agent again.',
  "error.marketplace.avatarInvalid": "The agent avatar is invalid.",
  "error.marketplace.secretInName": "Remove the secret or email address from the name before publishing.",
  "error.marketplace.secretInTitle": "Remove the secret or email address from the title before publishing.",
  "error.marketplace.secretInInstructions":
    "Remove the secret or email address from the instructions before publishing.",
  "error.marketplace.secretInRoutine":
    'Remove the secret or email address from the routine "{name}" before publishing.',
  "error.marketplace.secretInSkill": 'Remove the secret or email address from the skill "{name}" before publishing.',
  "error.marketplace.catalogLoadFailed": "The marketplace could not be loaded. Try again.",
  "error.marketplace.templateUnreadable": "This shared agent could not be read. Its owner may have removed it.",
});
