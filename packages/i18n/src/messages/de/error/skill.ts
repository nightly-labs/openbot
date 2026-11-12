import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/skill";

export const messages = {
  "error.skill.symlinks": "Fähigkeitspakete dürfen keine symbolischen Links enthalten.",
  "error.skill.expandedTooLarge": "Die entpackte Fähigkeit muss unter 10 MB groß sein.",
  "error.skill.irregularEntry": "Fähigkeitspakete dürfen nur reguläre Dateien und Ordner enthalten.",
  "error.skill.packageTooLarge": "Das Fähigkeitspaket muss unter 10 MB groß sein.",
  "error.skill.missingSkillFile": "Das Fähigkeitspaket muss SKILL.md in seinem Stammverzeichnis enthalten.",
  "error.skill.frontmatterMissing": "SKILL.md muss mit YAML-Frontmatter beginnen.",
  "error.skill.metadataInvalid": "Die Metadaten von SKILL.md sind ungültig.",
  "error.skill.nameAndDescriptionRequired": "SKILL.md benötigt einen gültigen Namen und eine Beschreibung.",
  "error.skill.zipInvalid": "Die gewählte ZIP-Datei ist ungültig.",
  "error.skill.fileCountInvalid": "Das Fähigkeitspaket hat eine ungültige Anzahl an Dateien.",
  "error.skill.slugInvalid": "Aus dem Fähigkeitsnamen kann kein gültiger Slug gebildet werden.",
  "error.skill.tooManyFiles": "Eine Fähigkeit kann höchstens {limit} Dateien enthalten.",
  "error.skill.unsafeFile": "Das Fähigkeitspaket enthält eine unsichere Datei: {name}",
  "error.skill.markdownTooLarge": "SKILL.md ist größer als 256 KB.",
  "error.skill.markdownUnreadable": "SKILL.md konnte nicht gelesen werden.",
  "error.skill.frontmatterInvalid": "Das Frontmatter von SKILL.md ist kein gültiges YAML.",
  "error.skill.descriptionLength": "SKILL.md benötigt eine Beschreibung mit 1 bis {limit} Zeichen.",
  "error.skill.nameMismatch": "SKILL.md benötigt „name: {slug}“, passend zum Ordnernamen.",
  "error.skill.draftExpired": "Das gewählte Fähigkeitspaket ist abgelaufen. Wähle es erneut.",
  "error.skill.localHasNoVersion": "Eine lokale Fähigkeit hat keine veröffentlichte Version.",
  "error.skill.publishLocalFirst":
    "Veröffentliche lokale Fähigkeiten einzeln, bevor du diesen Agenten veröffentlichst.",
  "error.skill.bundleMismatch":
    "Die heruntergeladene Fähigkeit stimmt nicht mit ihrem signierten Katalogeintrag überein.",
  "error.skill.metadataMismatch":
    "Die Metadaten der heruntergeladenen Fähigkeit stimmen nicht mit dem Katalog überein.",
  "error.skill.folderTaken": "Eine andere installierte Fähigkeit verwendet diesen Ordnernamen.",
  "error.skill.replaceModified": "Diese Fähigkeit hat lokale Änderungen. Bestätige das Ersetzen, um fortzufahren.",
  "error.skill.removeModified": "Diese Fähigkeit hat lokale Änderungen. Bestätige das Entfernen, um sie zu löschen.",
  "error.skill.notFound": "Fähigkeit nicht gefunden.",
  "error.skill.disableModified":
    "Diese Fähigkeit hat lokale Änderungen. Speichere beide Anbieterkopien oder gleiche sie ab, bevor du sie deaktivierst.",
  "error.skill.disableNeedsRepair": "Diese Fähigkeit muss repariert werden, bevor sie deaktiviert werden kann.",
  "error.skill.enableNeedsRepair": "Diese Fähigkeit muss repariert werden, bevor sie aktiviert werden kann.",
  "error.skill.providerFolderOccupied":
    "Der Anbieterordner dieser Fähigkeit ist belegt. Verschiebe seine Dateien oder gleiche sie ab, bevor du sie aktivierst.",
  "error.skill.chooseLocalAgent": "Wähle zuerst einen lokalen Agenten.",
  "error.skill.localLibraryUnavailable": "Die lokale Fähigkeitsbibliothek ist nicht verfügbar.",
  "error.skill.lockInvalid": "Der Eintrag der installierten Fähigkeit ist ungültig. Er wurde unverändert belassen.",
  "error.skill.installPathSymlink": "Installationspfade für Fähigkeiten dürfen keine symbolischen Links enthalten.",
  "error.skill.duplicateSlug": "Zwei Fähigkeiten heißen „{slug}“. Benenne eine davon vor dem Veröffentlichen um.",
  "error.skill.publishNeedsRepair": "{name} hat lokale Änderungen oder muss vor dem Veröffentlichen repariert werden.",
  "error.skill.publishUntracked":
    "{name} wurde vor der Einführung der genauen Versionserfassung installiert. Aktualisiere oder repariere sie vor dem Veröffentlichen.",
  "error.skill.tooManySkills": "Ein Agent kann bis zu {limit} Fähigkeiten haben.",
  "error.skill.unmanagedExists": "Unter {path} existiert bereits eine nicht verwaltete Fähigkeit.",
  "error.skill.managedSlug":
    "OpenBot gibt jedem Agenten eine eigene Fähigkeit {slug}. Gib dieser Fähigkeit einen anderen Namen.",
  "error.skill.templateMarkdownTooLarge":
    "{name}: SKILL.md ist größer als 64 KB. Kürze die Datei vor dem Veröffentlichen.",
  "error.skill.localNoRevisions": "Die lokale Fähigkeit hat keine veröffentlichten Überarbeitungen.",
  "error.skill.localNotFound":
    "Diese lokale Fähigkeit gibt es nicht. Prüfe ihre ID in der Liste der lokalen Fähigkeiten.",
  "error.skill.localRevisionNotFound":
    "Diese lokale Fähigkeit hat keine Überarbeitung {revision}. Die neueste Überarbeitung ist {latest}.",
  "error.skill.localNameTaken":
    "Eine lokale Fähigkeit mit diesem Namen existiert bereits. Überarbeite sie stattdessen.",
  "error.skill.localKeepName": "Behalte den Namen der Fähigkeit bei der Überarbeitung bei.",
  "error.skill.localRelativeFolder":
    "Verwende einen relativen Fähigkeitsordner im Arbeitsbereich des aktuellen Agenten.",
  "error.skill.localSourceOutside": "Die Fähigkeitsquelle muss im Arbeitsbereich des Agenten liegen.",
  "error.skill.localSourceNotFolder": "Die Fähigkeitsquelle muss ein Ordner sein.",
  "error.skill.localMissingSkillFile": "Der Fähigkeitsordner benötigt SKILL.md in seinem Stammverzeichnis.",
  "error.skill.pathSymlink": "Fähigkeitspfade dürfen keine symbolischen Links enthalten.",
  "error.skill.folderNotRead": "{provider} liest {folder} nicht. Kopiere diesen Ordner nach {target}.",
  "error.skill.githubLinkInvalid": "Füge einen Link zu einem GitHub-Repository oder -Ordner ein.",
  "error.skill.githubNotFound":
    "OpenBot kann {repository} nicht öffnen. Das Repository ist privat oder existiert nicht.",
  "error.skill.githubNoSkills": "In {folder} gibt es keine SKILL.md.",
  "error.skill.githubUnavailable": "OpenBot kann GitHub gerade nicht lesen. Versuche es später erneut.",
  "error.skill.githubRateLimited":
    "GitHub begrenzt, wie oft OpenBot es ohne Konto lesen kann. Versuche es in einer Stunde erneut.",
  "error.skill.githubTooLarge": "OpenBot kann nicht alle Dateien von {repository} lesen. Das Repository ist zu groß.",
  "error.skill.githubHostTooOld": "Aktualisiere diesen Server, um Fähigkeiten von GitHub hinzuzufügen.",
  "error.skill.publishGithub":
    "{name} stammt von GitHub. Du kannst nur Fähigkeiten veröffentlichen, die du selbst erstellt hast.",
} as const satisfies PartialTranslation<typeof source>;
