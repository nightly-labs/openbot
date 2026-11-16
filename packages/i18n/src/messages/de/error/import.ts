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
  "error.import.unsafeFile": "Der Export enthält eine unsichere Datei: {name}",
  "error.import.tooManyFiles": "Der Export darf höchstens {limit} Dateien enthalten.",
  "error.import.diskSpace":
    "{name}: Die Dateien benötigen {size} GB freien Speicherplatz, frei sind {free} GB. Gib Speicherplatz frei und importiere den Agenten erneut.",
  "error.import.remoteExpandedTooLarge":
    "Der entpackte Export muss unter 500 MB groß sein und weniger als {limit} Dateien enthalten.",
  "error.import.zipInvalid":
    "Die gewählte Datei ist keine gültige .zip-Datei. Falls Grok Bot sie noch speichert, warte und wähle sie erneut.",
  "error.import.entryDamaged": "Die Datei ist im Export beschädigt.",
  "error.import.foldersSkipped":
    "{number} Dateien in .git- und node_modules-Ordnern werden ausgelassen. Ein Tool kann sie neu erstellen.",
  "error.import.empty": "Der Export ist leer.",
  "error.import.remoteZipTooLarge":
    "Für den Import auf einen Server, dem du beigetreten bist, muss der Export eine .zip-Datei unter 100 MB sein.",
  "error.import.hostBusy": "Der Server liest andere Exporte. Versuche es in einigen Minuten erneut.",
  "error.import.uploadDiskSpace":
    "Der Export braucht {size} GB freien Speicher auf dem Server, und {free} GB sind frei. Gib auf dem Server Speicher frei und wähle den Export dann erneut.",
  "error.import.remoteZipTooLargeOldHost":
    "Dieser Server nimmt Exporte bis 100 MB an. Aktualisiere OpenBot auf dem Server, um einen größeren Export zu importieren.",
  "error.import.skillKept":
    "{name}: Der Server hat die Fähigkeit „{skill}“ bereits. Der Agent verwendet daher diese Fähigkeit. Bitte einen Administrator, sie zu aktualisieren.",
  "error.import.skillRenamed":
    "{name}: Der Name der Fähigkeit „{skill}“ ist dem Namen einer anderen Fähigkeit zu ähnlich. Daher wird sie als „{renamed}“ gespeichert.",
  "error.import.transferRemoteTooLarge":
    "Eine Übertragungsdatei für einen beigetretenen Server muss kleiner als 100 MB sein. Deaktiviere die Dateien der Arbeitsbereiche oder exportiere weniger Agenten.",
  "error.import.transferNotFile": "Diese Datei ist keine OpenBot-Übertragungsdatei.",
  "error.import.transferNewer":
    "Eine neuere Version von OpenBot hat diese Datei erstellt. Aktualisiere OpenBot und versuche es erneut.",
  "error.import.transferEmpty": "Die Datei enthält keine Agenten und keine Einstellungen.",
  "error.import.transferTooLarge":
    "Eine Übertragungsdatei muss kleiner als 2 GB sein und weniger als 50.000 Dateien enthalten. Deaktiviere die Dateien der Arbeitsbereiche oder exportiere weniger Agenten.",
  "error.import.transferAgentInvalid": "Agent {number} in der Datei ist ungültig und wird übersprungen.",
  "error.import.transferSettingsInvalid":
    "Die App-Einstellungen in der Datei sind ungültig und werden nicht importiert.",
  "error.import.transferModelMissing":
    "{name}: Das Modell „{model}“ ist hier noch nicht verfügbar, daher verwendet der Agent das Standardmodell. Wähle das Modell erneut, sobald sein Anbieter bereit ist.",
  "error.import.transferSettingSkipped": "{name} wird nicht importiert. {reason}",
  "error.import.transferRunsSkipped": "{name}: Der Ausführungsverlauf der Routine „{routine}“ wird nicht importiert.",
  "error.import.transferSharedSkillsSkipped":
    "Die gemeinsamen Fähigkeiten konnten nicht gelesen werden und sind daher nicht in der Datei.",
  "error.import.transferSharedSkillsNotAdded":
    "Die geteilten Skills in der Datei konnten nicht zu diesem Server hinzugefügt werden.",
  "error.import.transferMemberPreferencesSkipped": {
    one: "Die Auswahl von {count} Mitglied konnte nicht gespeichert werden.",
    other: "Die Auswahl von {count} Mitgliedern konnte nicht gespeichert werden.",
  },
  "error.import.transferSharedSkillExists":
    "Auf diesem Server gibt es bereits eine gemeinsame Fähigkeit mit diesem Namen und anderen Dateien.",
  "error.import.transferServerPreferencesSkipped": {
    one: "{count} Serverpräferenz in der Datei ist hier nicht gültig und wird daher nicht importiert.",
    other: "{count} Serverpräferenzen in der Datei sind hier nicht gültig und werden daher nicht importiert.",
  },
  "error.import.transferRoutineFlowSkipped": "Der Import hat einen Routinenablauf ausgelassen. {reason}",
  "error.import.transferCustomAgentCommand":
    "{name}: Eigene Agenten werden nicht importiert, da sie einen Befehl ausführen. Prüfe den Befehl „{command}“ und füge den Agenten in den Einstellungen erneut hinzu.",
  "error.import.transferSkillLimit":
    "{name}: Nur die ersten {limit} seiner {total} Fähigkeiten sind in der Datei, da ein Agent {limit} Fähigkeiten haben kann.",
  "error.import.transferFilesGone":
    "{number} Dateien wurden während des Exports gelöscht und sind daher nicht in der Datei.",
  "error.import.transferProviderKey": "{name}: Gib den API-Schlüssel in den Einstellungen erneut ein.",
  "error.import.transferAgentEnv": "{name}: Gib die Werte von {names} in den Einstellungen erneut ein.",
  "error.import.transferMcpValues":
    "{name}: Der MCP-Server wird deaktiviert hinzugefügt. Prüfe seinen Befehl, gib seine Werte und die vollständige Adresse erneut ein und aktiviere ihn in den MCP-Einstellungen.",
  "error.import.transferValuesCleared":
    "{name}: Werte, die ein Geheimnis enthalten können, wurden aus den Argumenten oder der Adresse entfernt. Gib sie in den Einstellungen erneut ein.",
  "error.import.transferSharedKept":
    "{number} Dateien im gemeinsamen Ordner sind hier schon vorhanden und bleiben unverändert.",
} as const satisfies PartialTranslation<typeof source>;
