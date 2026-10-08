import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.timezoneInvalid": "Die lokale Zeitzone ist ungültig.",
  "error.marketplace.installedAgentMissing": "Der installierte Agent existiert nicht mehr.",
  "error.marketplace.differentListing": "Dieser lokale Agent wurde aus einem anderen Marketplace-Agenten installiert.",
  "error.marketplace.marketplaceAvatarInvalid": "Der Avatar des Marketplace-Agenten ist ungültig.",
  "error.marketplace.shareCardInvalid": "Die Freigabekarte ist ungültig.",
  "error.marketplace.cannotPublish": "Dieser Agent kann nicht veröffentlicht werden.",
  "error.marketplace.templateName": {
    one: "Gib diesem Agenten einen Namen mit 1 bis {count} Zeichen.",
    other: "Gib diesem Agenten einen Namen mit 1 bis {count} Zeichen.",
  },
  "error.marketplace.templateRole": {
    one: "Die Rolle ist länger als {count} Zeichen. Kürze sie.",
    other: "Die Rolle ist länger als {count} Zeichen. Kürze sie.",
  },
  "error.marketplace.templateNoInstructions": "Füge diesem Agenten Anweisungen hinzu, bevor du ihn veröffentlichst.",
  "error.marketplace.templateInstructions": {
    one: "Die Anweisungen sind länger als {count} Zeichen. Kürze sie.",
    other: "Die Anweisungen sind länger als {count} Zeichen. Kürze sie.",
  },
  "error.marketplace.templateAvatar":
    "Der Avatar dieses Agenten ist ungültig. Wähle ihn erneut in den Agenteneinstellungen.",
  "error.marketplace.templateSkills": {
    one: "Ein Agent kann bis zu {count} Fähigkeit veröffentlichen. Entferne einige.",
    other: "Ein Agent kann bis zu {count} Fähigkeiten veröffentlichen. Entferne einige.",
  },
  "error.marketplace.templateLocalSkills": {
    one: "Ein Agent kann bis zu {count} lokale Fähigkeit veröffentlichen. Entferne einige.",
    other: "Ein Agent kann bis zu {count} lokale Fähigkeiten veröffentlichen. Entferne einige.",
  },
  "error.marketplace.templateSkill":
    "Die Fähigkeit „{name}“ kann nicht veröffentlicht werden. Prüfe ihren Namen und ihre SKILL.md.",
  "error.marketplace.templateRoutines": {
    one: "Ein Agent kann bis zu {count} Routine veröffentlichen. Entferne einige.",
    other: "Ein Agent kann bis zu {count} Routinen veröffentlichen. Entferne einige.",
  },
  "error.marketplace.templateRoutine": {
    one: "Die Routine „{name}“ benötigt einen Namen mit bis zu {count} Zeichen und eine Anweisung.",
    other: "Die Routine „{name}“ benötigt einen Namen mit bis zu {count} Zeichen und eine Anweisung.",
  },
  "error.marketplace.templateRoutineNoName": "ohne Namen",
  "error.marketplace.templateTooLarge":
    "Dieser Agent ist zu groß zum Veröffentlichen. Kürze seine Anweisungen, Fähigkeiten oder Routinen.",
  "error.marketplace.linkInvalid": "Der Agentenlink ist ungültig.",
  "error.marketplace.changedSinceOpened":
    "Dieser Agent wurde geändert, nachdem du ihn geöffnet hast. Öffne den Link erneut, um die neue Version zu prüfen.",
  "error.marketplace.skillNameConflict":
    "Du hast bereits eine andere lokale Fähigkeit mit dem Namen „{name}“. Benenne sie um oder entferne sie und füge diesen Agenten erneut hinzu.",
  "error.marketplace.avatarInvalid": "Der Agentenavatar ist ungültig.",
  "error.marketplace.secretInName":
    "Entferne das Geheimnis oder die E-Mail-Adresse aus dem Namen, bevor du veröffentlichst.",
  "error.marketplace.secretInTitle":
    "Entferne das Geheimnis oder die E-Mail-Adresse aus dem Titel, bevor du veröffentlichst.",
  "error.marketplace.secretInInstructions":
    "Entferne das Geheimnis oder die E-Mail-Adresse aus den Anweisungen, bevor du veröffentlichst.",
  "error.marketplace.secretInRoutine":
    "Entferne das Geheimnis oder die E-Mail-Adresse aus der Routine „{name}“, bevor du veröffentlichst.",
  "error.marketplace.secretInSkill":
    "Entferne das Geheimnis oder die E-Mail-Adresse aus der Fähigkeit „{name}“, bevor du veröffentlichst.",
  "error.marketplace.catalogLoadFailed": "Der Marketplace konnte nicht geladen werden. Versuche es erneut.",
  "error.marketplace.templateUnreadable":
    "Dieser geteilte Agent konnte nicht gelesen werden. Sein Eigentümer hat ihn möglicherweise entfernt.",
} as const satisfies PartialTranslation<typeof source>;
