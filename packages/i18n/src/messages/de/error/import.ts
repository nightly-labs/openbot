import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  "error.import.manifestNotJson": "{manifest} ist kein gültiges JSON.",
  "error.import.notAgentExport": "{manifest} ist kein OpenBot-Agentenexport.",
  "error.import.newerExportSkill":
    "Dieser Export wurde mit einer neueren Exportfähigkeit erstellt. Aktualisiere OpenBot und versuche es erneut.",
  "error.import.noAgents": "Der Export enthält keine Agenten.",
  "error.import.tooManyAgents": "Der Export enthält mehr als {limit} Agenten.",
  "error.import.tooManyChannels": "Der Export enthält mehr als {limit} Kanäle.",
  "error.import.channelSkipped":
    "{name}: Der Kanal wird ausgelassen, da keiner seiner Agenten im Export enthalten ist.",
  "error.import.membersLeftOut": "{name}: Mitglieder, die keine Agenten in diesem Export sind, werden ausgelassen.",
  "error.import.leadNotMember": "{name}: Die Kanalleitung ist kein Mitglied. Der Kanal hat daher keine Leitung.",
  "error.import.routineLimit": "{name}: Nur die ersten {limit} Routinen werden importiert.",
  "error.import.routineInvalid":
    "{name}: Die Routine „{routine}“ wird ausgelassen, da ihr Name, Text oder Zeitplan ungültig ist.",
  "error.import.memoriesSkipped":
    "{name}: {skipped} Erinnerungen werden ausgelassen, da sie leer oder länger als {limit} Zeichen sind.",
  "error.import.memoryLimit": "{name}: Nur die ersten {limit} Erinnerungen werden importiert.",
  "error.import.manifestMissing": "Der Export muss {manifest} enthalten.",
  "error.import.skillFolderMissing": "{name}: Der Fähigkeitsordner {skill} enthält keine SKILL.md.",
  "error.import.avatarSkipped": "{name}: Der Avatar wird ausgelassen, da er kein PNG, JPEG oder WebP unter 512 KB ist.",
  "error.import.exportClosed": "Der Export ist nicht mehr geöffnet. Wähle ihn erneut.",
  "error.import.agentNotInExport": "Die Auswahl enthält einen Agenten, der nicht im Export enthalten ist.",
  "error.import.channelNotInExport": "Die Auswahl enthält einen Kanal, der nicht im Export enthalten ist.",
  "error.import.serverAgentLimit": "Ein Server kann höchstens {limit} Agenten haben.",
  "error.import.exportChanged": "Der Export wurde nach der Prüfung geändert. Wähle ihn erneut.",
  "error.import.noMembersImported": "Keiner seiner Agenten wurde importiert.",
  "error.import.leadNotImported": "{name}: Die Leitung wurde nicht importiert. Es ist daher keine Leitung vorhanden.",
  "error.import.routineSkipped": "{name}: Die Routine „{routine}“ wird ausgelassen. {reason}",
  "error.import.fileRenamed": "{name}: {file} existiert bereits. Diese Kopie wird daher als {saved} gespeichert.",
  "error.import.fileSkipped": "{name}: Die Datei {file} wird ausgelassen. {reason}",
  "error.import.chooseZip": "Wähle eine .zip-Datei.",
  "error.import.zipTooLarge": "Der Export muss eine .zip-Datei unter 500 MB sein.",
  "error.import.unsafeFile": "Der Export enthält eine unsichere Datei: {name}",
  "error.import.expandedTooLarge":
    "Der entpackte Export muss unter 500 MB groß sein und weniger als {limit} Dateien enthalten.",
  "error.import.zipInvalid":
    "Die gewählte Datei ist keine gültige .zip-Datei. Falls Grok Bot sie noch speichert, warte und wähle sie erneut.",
  "error.import.empty": "Der Export ist leer.",
  "error.import.remoteZipTooLarge":
    "Für den Import auf einen Server, dem du beigetreten bist, muss der Export eine .zip-Datei unter 100 MB sein.",
  "error.import.hostBusy": "Der Server liest andere Exporte. Versuche es in einigen Minuten erneut.",
  "error.import.skillKept":
    "{name}: Der Server hat die Fähigkeit „{skill}“ bereits. Der Agent verwendet daher diese Fähigkeit. Bitte einen Administrator, sie zu aktualisieren.",
} as const satisfies PartialTranslation<typeof source>;
