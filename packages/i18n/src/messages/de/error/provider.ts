import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/provider";

export const messages = {
  "error.provider.mcpConfig":
    "OpenBot konnte die MCP-Server nicht in der Codex-Konfiguration registrieren. Prüfe, ob deine Codex-Datei config.toml gültig und beschreibbar ist, und starte OpenBot neu.",
  "error.provider.computerUseConfig":
    "OpenBot konnte die Computersteuerung nicht in der Codex-Konfiguration registrieren. Prüfe, ob deine Codex-Datei config.toml gültig und beschreibbar ist, und starte OpenBot neu. Du kannst die Computersteuerung in den Agenteneinstellungen ausschalten, um ohne sie fortzufahren.",
  "error.provider.codexUnresponsive": "Codex hat nicht mehr geantwortet, daher hat OpenBot den Prozess beendet.",
  "error.provider.acpUnresponsive":
    "{provider} hat nicht rechtzeitig geantwortet, daher hat OpenBot den Prozess beendet.",
  "error.provider.acpMcpNotLoaded":
    "{provider} hat die OpenBot-Tools nicht geladen, daher kann dieser Agent sie nicht nutzen und seine Teammitglieder nicht erreichen. Eine Team-Richtlinie von {provider} kann lokale MCP-Server blockieren. Bitte deinen Team-Admin, sie zu erlauben, und versuche es dann erneut.",
  "error.provider.endpointsReadOnly":
    "Die gespeicherten Endpunkte wurden mit einer neueren OpenBot-Version geschrieben oder die Datei kann nicht gelesen werden. Aktualisiere OpenBot, um sie zu ändern.",
  "error.provider.endpointNoSecureStorage":
    "Dieser Computer hat keinen sicheren Speicher. Ein API-Schlüssel oder Header kann daher nicht gespeichert werden. Entferne sie oder verwende einen Endpunkt ohne Zugangsdaten.",
  "error.provider.endpointDuplicate":
    "Ein Endpunkt mit dieser Anbieter-ID ist bereits gespeichert. Entferne ihn zuerst oder verwende eine andere ID.",
  "error.provider.endpointNotSaved":
    "Dieser Endpunkt ist nicht gespeichert. Aktualisiere die Liste und versuche es erneut.",
  "error.provider.endpointKeyForNewAddress":
    "Die Adresse hat einen neuen Host oder Port. Gib den API-Schlüssel und die Header erneut ein, damit die gespeicherten Daten nicht dorthin gesendet werden.",
  "error.provider.endpointSecretUnreadable":
    "Dieser Computer kann den gespeicherten API-Schlüssel und die Header nicht lesen. Gib sie erneut ein, damit keine Daten verloren gehen.",
  "error.provider.discoveryTimeout": "{host} hat nicht rechtzeitig geantwortet.",
  "error.provider.discoveryUnreachable": "OpenBot konnte keine Verbindung zu {host} herstellen.",
  "error.provider.discoveryRedirect": "{host} hat eine Weiterleitung gesendet. Gib die endgültige Serveradresse ein.",
  "error.provider.discoveryRefused": "{host} hat die Anfrage abgelehnt. Prüfe den API-Schlüssel und die Header.",
  "error.provider.discoveryHttp": "{host} hat mit HTTP {status} geantwortet.",
  "error.provider.discoveryTooLarge": "Die Modellliste von {host} ist zu groß.",
  "error.provider.discoveryInvalid": "{host} hat keine mit OpenAI kompatible Modellliste gesendet.",
  "error.provider.detectionSettingsReadOnly":
    "Die Erkennungseinstellungen wurden mit einer neueren OpenBot-Version geschrieben oder die Datei kann nicht gelesen werden. Aktualisiere OpenBot, um sie zu ändern.",
  "error.provider.detectionEntryInvalid":
    "Eine Adresse muss eine http://- oder https://-URL ohne Passwort sein. Ein Ordner muss ein absoluter Pfad sein.",
  "error.provider.detectionEntriesTooMany": "Es gibt zu viele Adressen oder Ordner.",
  "error.provider.credentialFileUnreadable": "Die Zugangsdaten-Datei des Anbieters ist nicht lesbar.",
  "error.provider.credentialFileTooLarge": "Die Zugangsdaten-Datei des Anbieters ist zu groß.",
  "error.provider.archiveSpecialFile": "Das Laufzeitarchiv enthält einen Link oder eine spezielle Datei.",
  "error.provider.archiveUnsafePath": "Das Laufzeitarchiv enthält einen unsicheren Pfad.",
  "error.provider.runtimeSpecialFile": "Die Laufzeit enthält einen Link oder eine spezielle Datei.",
  "error.provider.codexArchivePath": "Das Codex-Archiv hat einen unerwarteten Pfad.",
  "error.provider.codexVersionUnexpected": "Unerwartete Version der Codex-Laufzeit.",
  "error.provider.claudeArchivePath": "Das Claude-Archiv hat einen unerwarteten Pfad.",
  "error.provider.claudePackageMismatch": "Das Claude-Paket stimmt nicht mit dem Laufzeitkatalog überein.",
  "error.provider.claudeChecksum": "Die Prüfsumme der Claude-Laufzeit stimmt nicht überein.",
  "error.provider.claudeLicenseChecksum": "Die Prüfsumme der Claude-Lizenz stimmt nicht überein.",
  "error.provider.opencodeArchivePath": "Das OpenCode-Archiv hat einen unerwarteten Pfad.",
  "error.provider.opencodePackageMismatch": "Das OpenCode-Paket stimmt nicht mit dem Laufzeitkatalog überein.",
  "error.provider.opencodeChecksum": "Die Prüfsumme der OpenCode-Laufzeit stimmt nicht überein.",
  "error.provider.opencodeLicenseChecksum": "Die Prüfsumme der OpenCode-Lizenz stimmt nicht überein.",
  "error.provider.grokChecksum": "Die Prüfsumme der Grok-Laufzeit stimmt nicht überein.",
  "error.provider.grokLicenseChecksum": "Die Prüfsumme der Grok-Lizenz stimmt nicht überein.",
  "error.provider.grokNoticesChecksum": "Die Prüfsumme der Grok-Hinweise stimmt nicht überein.",
  "error.provider.bunArchivePath": "Das Bun-Archiv hat einen unerwarteten Pfad.",
  "error.provider.bunPackageMismatch": "Das Bun-Paket stimmt nicht mit dem Laufzeitkatalog überein.",
  "error.provider.bunChecksum": "Die Prüfsumme der Bun-Laufzeit stimmt nicht überein.",
  "error.provider.bunLicenseChecksum": "Die Prüfsumme der Bun-Lizenz stimmt nicht überein.",
  "error.provider.bunxDamaged": "Das Ausführungsprogramm des Bun-Paketmanagers fehlt oder ist beschädigt.",
  "error.provider.releaseSourcesUnreachable":
    "OpenBot konnte die Versionsquellen des Anbieters nicht erreichen. Prüfe die Verbindung und versuche es erneut.",
  "error.provider.runtimesUnsupported": "Anbieterlaufzeiten sind auf dieser Plattform nicht verfügbar.",
  "error.provider.closing": "OpenBot wird geschlossen.",
  "error.provider.removeWhileOn": "Schalte den Anbieter aus, bevor du seinen Download entfernst.",
  "error.provider.removeWhileDownloading": "Warte, bis der Download fertig ist, und entferne ihn dann.",
  "error.provider.removeIncomplete": "Ein Programm verwendet Dateien dieser CLI. Schließe es und versuche es erneut.",
  "error.provider.removeDownloadsFailed": "Die CLI-Downloads von {providers} konnten nicht entfernt werden.",
  "error.provider.cliOverride": "Entferne den ausdrücklich festgelegten CLI-Pfad, bevor du in OpenBot aktualisierst.",
  "error.provider.runtimeUpdateIncomplete": "Die Laufzeitaktualisierung wurde nicht abgeschlossen.",
  "error.provider.downloadHttp": "Der Laufzeitdownload ist mit HTTP {status} fehlgeschlagen.",
  "error.provider.downloadNoData": "Der Laufzeitdownload hat keine Daten zurückgegeben.",
  "error.provider.downloadSize": "Der Laufzeitdownload hat eine unerwartete Größe.",
  "error.provider.downloadIntegrity": "Der Laufzeitdownload hat die Integritätsprüfung nicht bestanden.",
  "error.provider.runtimeReplacing":
    "Die Laufzeit konnte nicht installiert werden, da eine andere Instanz sie ersetzt.",
  "error.provider.runtimeFilesInUse":
    "Die Laufzeit konnte nicht installiert werden, da ein anderes Programm ihre Dateien geöffnet hat. Schließe es und versuche es erneut.",
  "error.provider.metadataHttp": "Der Download der Laufzeitmetadaten ist mit HTTP {status} fehlgeschlagen.",
  "error.provider.metadataIntegrity": "Die Laufzeitmetadaten haben die Integritätsprüfung nicht bestanden.",
  "error.provider.diskSpace": "Für diesen Anbieter ist nicht genug freier Speicherplatz vorhanden.",
  "error.provider.unexpectedVersion": "Die Anbieterlaufzeit hat eine unerwartete Version zurückgegeben.",
  "error.provider.metadataNoData": "Der Download der Laufzeitmetadaten hat keine Daten zurückgegeben.",
  "error.provider.metadataTooLarge": "Die Laufzeitmetadaten sind zu groß.",
  "error.provider.requestFailed": "OpenBot konnte {url} nicht herunterladen. {reason}",
  "error.provider.installRecordMismatch": "Der Installationseintrag der Laufzeit stimmt nicht überein.",
  "error.provider.runtimeChecksum": "Die Prüfsumme der Anbieterlaufzeit stimmt nicht überein.",
  "error.provider.codexReleaseShape": "Die Codex-Version hat eine unerwartete Struktur.",
  "error.provider.codexReleaseNoDownload": "Die Codex-Version hat keinen überprüfbaren Download für diesen Computer.",
  "error.provider.claudeReleaseShape": "Die Claude-Version hat eine unerwartete Struktur.",
  "error.provider.grokReleaseVersion": "Die Grok-Veröffentlichung hat eine unerwartete Version.",
  "error.provider.blockedListShape": "Die Liste gesperrter Versionen hat eine unerwartete Struktur.",
  "error.provider.releaseNoDownload": "Die Version von {name} hat keinen überprüfbaren Download.",
  "error.provider.releaseSizeUnknown": "Die Größe des Versionsdownloads ist unbekannt.",
  "error.provider.releaseMetadataNotObject": "Die Versionsmetadaten sind kein JSON-Objekt.",
  "error.provider.releaseCheckHttp": "Die Versionsprüfung ist mit HTTP {status} fehlgeschlagen.",
  "error.provider.releaseMetadataTooLarge": "Die Versionsmetadaten sind zu groß.",
  "error.provider.idInvalid": "Eine Anbieter-ID darf nur Kleinbuchstaben, Ziffern, `-` oder `_` enthalten.",
  "error.provider.baseUrlInvalid": "Die Basis-URL ist keine URL.",
  "error.provider.baseUrlProtocol": "Die Basis-URL muss mit http:// oder https:// beginnen.",
  "error.provider.baseUrlCredentials":
    "Die Basis-URL darf keinen Benutzernamen und kein Passwort enthalten. Setze die Zugangsdaten in einen Header.",
  "error.provider.modelsRequired": "Mindestens ein Modell ist erforderlich.",
  "error.provider.modelsTooMany": "Es gibt zu viele Modelle.",
  "error.provider.modelIdCharacter": "Eine Modell-ID enthält ein unzulässiges Zeichen.",
  "error.provider.modelIdDuplicate": "Zwei Modelle haben dieselbe ID.",
  "error.provider.contextWindowInvalid":
    "Das Kontextfenster eines Modells muss eine ganze Zahl von Tokens zwischen {min} und {max} sein.",
  "error.provider.headersTooMany": "Es gibt zu viele Header.",
  "error.provider.headerNameCharacter": "Ein Headername enthält ein Zeichen, das HTTP nicht erlaubt.",
  "error.provider.headerNameTooLong": "Ein Headername ist zu lang.",
  "error.provider.headerNameDuplicate": "Zwei Header haben denselben Namen.",
  "error.provider.headerValueInvalid": "Ein Headerwert fehlt oder ist zu lang.",
  "error.provider.headerValueMissing": "Gib einen Wert für den Header {name} ein.",
  "error.provider.apiKeyTooLong": "Der API-Schlüssel ist zu lang.",
  "error.provider.localOnly": "Anbieter können nur auf dem Computer geändert werden, auf dem die Agenten laufen.",
  "error.provider.keyRequired": "Ein Anbieterschlüssel ist erforderlich.",
  "error.provider.keyTooLong": "Der Anbieterschlüssel ist zu lang.",
  "error.provider.keyInvalidCharacters":
    "Der Anbieterschlüssel enthält ein Leerzeichen oder ein Zeichen, das in einem Schlüssel nicht vorkommen kann.",
  "error.provider.noModel": "Der gewählte Anbieter hat kein verfügbares Modell.",
  "error.provider.noModelNamed": "{provider} hat kein verfügbares Modell.",
  "error.provider.acpNoModels": "Die ACP CLI hat keine ACP-Modelle gemeldet. OpenBot wird kein Ersatzmodell erraten.",
  "error.provider.endpointRemoveBusy":
    "Warte, bis der aktive Durchlauf und die Warteschlange abgeschlossen sind, bevor du diesen Endpunkt entfernst.",
  "error.provider.codexOutdated": "Codex CLI {version} ist zu alt. OpenBot benötigt 0.156.0 oder neuer.",
  "error.provider.codexNotStarted": "Codex CLI wurde gefunden, konnte aber nicht gestartet werden.",
  "error.provider.codexNotStartedHint":
    "Codex CLI wurde gefunden, konnte aber nicht gestartet werden. Führe `codex --version` in einem neuen Terminal aus.",
  "error.provider.codexManagedNotStarted":
    "ChatGPT wurde heruntergeladen, konnte aber nicht gestartet werden. Lade es in OpenBot erneut herunter.",
  "error.provider.codexMissing": "ChatGPT wurde nicht heruntergeladen. Lade es in OpenBot herunter, um fortzufahren.",
  "error.provider.codexConfigIgnored": {
    one: "Codex hat {count} Einstellung in seiner Konfiguration ignoriert: {settings}. Korrigiere oder entferne sie oder aktualisiere Codex.",
    other:
      "Codex hat {count} Einstellungen in seiner Konfiguration ignoriert: {settings}. Korrigiere oder entferne sie oder aktualisiere Codex.",
  },
  "error.provider.codexConfigIgnoredUnnamed": {
    one: "Codex hat {count} Einstellung in seiner Konfiguration ignoriert. Korrigiere oder entferne sie oder aktualisiere Codex.",
    other:
      "Codex hat {count} Einstellungen in seiner Konfiguration ignoriert. Korrigiere oder entferne sie oder aktualisiere Codex.",
  },
  "error.provider.claudeOutdated": "Claude Code {version} ist zu alt. OpenBot benötigt 2.1.232 oder neuer.",
  "error.provider.claudeNotStarted": "Claude CLI wurde gefunden, konnte aber nicht gestartet werden.",
  "error.provider.claudeNotStartedHint":
    "Claude CLI wurde gefunden, konnte aber nicht gestartet werden. Führe `claude --version` in einem neuen Terminal aus.",
  "error.provider.claudeManagedNotStarted":
    "Claude wurde heruntergeladen, konnte aber nicht gestartet werden. Lade es in OpenBot erneut herunter.",
  "error.provider.claudeMissing": "Claude wurde nicht heruntergeladen. Lade es in OpenBot herunter, um fortzufahren.",
  "error.provider.grokOutdated": "Grok CLI {version} ist zu alt. OpenBot benötigt 1.0.5 oder neuer.",
  "error.provider.grokNotStarted": "Grok CLI wurde gefunden, konnte aber nicht gestartet werden.",
  "error.provider.grokNotStartedHint":
    "Grok CLI wurde gefunden, konnte aber nicht gestartet werden. Führe `grok --version` in einem neuen Terminal aus.",
  "error.provider.grokMissing": "Grok wurde nicht heruntergeladen. Lade es in OpenBot herunter, um fortzufahren.",
  "error.provider.opencodeNotStarted":
    "OpenCode konnte nicht starten. Führe `opencode --version` in einem Terminal aus.",
  "error.provider.opencodeMissing":
    "OpenCode wurde nicht heruntergeladen. Lade es in OpenBot herunter, um fortzufahren.",
  "error.provider.codexVersionUnreadable": "Die Version von Codex CLI konnte nicht gelesen werden.",
  "error.provider.claudeVersionUnreadable": "Die Version von Claude CLI konnte nicht gelesen werden.",
  "error.provider.grokVersionUnreadable": "Die Version von Grok CLI konnte nicht gelesen werden.",
  "error.provider.opencodeVersionUnreadable": "Die Version von OpenCode CLI konnte nicht gelesen werden.",
  "error.provider.bunVersionUnreadable": "Die Version der Bun-Laufzeit konnte nicht gelesen werden.",
  "error.provider.connectBeforeProfile": "Verbinde den gewählten Anbieter, bevor du ein Profil erstellst.",
  "error.provider.cliNotReady": "Die CLI von {provider} ist nicht bereit oder nicht angemeldet.",
  "error.provider.cliTimedOut":
    "{provider} hat nicht rechtzeitig geantwortet. Der Computer ist möglicherweise ausgelastet. OpenBot versucht es erneut.",
  "error.provider.cliTimedOutRefresh":
    "{provider} hat nicht rechtzeitig geantwortet. Der Computer ist möglicherweise ausgelastet. Aktualisiere die Anbieter, um es erneut zu versuchen.",
  "error.provider.acpStartTimedOut":
    "{provider} wurde nicht innerhalb von {seconds} s fertig gestartet. Der Computer ist möglicherweise ausgelastet.",
  "error.provider.acpModelsTimedOut":
    "{provider} hat seine Modelle nicht innerhalb von {seconds} s aufgelistet. Der Computer ist möglicherweise ausgelastet.",
  "error.provider.startStopped":
    "{provider} ist mehrmals hintereinander nicht gestartet, daher versucht OpenBot es nicht mehr. Aktualisiere die Anbieter, um es erneut zu versuchen.",
  "error.provider.tempDiskSpace":
    "{provider} braucht zum Starten mindestens 1 GB freien Speicherplatz. Gib Speicherplatz frei und aktualisiere dann die Anbieter.",
  "error.provider.noCodeSignIn": "Bei {provider} ist keine Anmeldung mit einem Code möglich.",
  "error.provider.codeLoginNoLink": "Der Anbieter hat keinen Anmeldelink angezeigt. Versuche es erneut.",
  "error.provider.hostSignInEnded": "Die Anmeldung bei {provider} wurde nicht abgeschlossen. Versuche es erneut.",
  "error.provider.codeLoginNotWaiting": "Keine Anmeldung wartet auf einen Code. Starte die Anmeldung erneut.",
  "error.provider.codeLoginBadCode": "Füge den Code ein, den die Anmeldeseite anzeigt.",
  "error.provider.codeLoginRefused": "Der Anbieter hat den Code nicht akzeptiert. Starte die Anmeldung erneut.",
  "error.provider.codeLoginUnsupported":
    "Dieser Server unterstützt keine Anmeldung mit einem eingefügten Code. Melde dich im Browser auf dem Servercomputer an.",
  "error.provider.cliBusyRetry":
    "Die CLI von {provider} bearbeitet einen Durchlauf. Warte auf den Abschluss und versuche es erneut.",
  "error.provider.cliSigningIn":
    "Die CLI von {provider} meldet sich an. Beende die Anmeldung oder brich sie ab und aktualisiere dann.",
  "error.provider.cliBusyUpdate":
    "Die CLI von {provider} bearbeitet einen Durchlauf. Warte auf den Abschluss und aktualisiere dann.",
  "error.provider.cliSelectFailed": "OpenBot konnte die installierte verwaltete CLI nicht auswählen.",
  "error.provider.noAuthenticatedAccount": "{provider} hat kein authentifiziertes Konto zurückgegeben.",
  "error.provider.signInExpired":
    "Deine Anmeldung bei {provider} ist abgelaufen. Melde dich erneut an, um fortzufahren.",
  "error.provider.cliActivateFailed": "OpenBot konnte die verwaltete CLI nicht aktivieren.",
  "error.provider.cliBusyReconnect":
    "Die CLI von {provider} bearbeitet einen Durchlauf. Warte auf den Abschluss und verbinde sie dann erneut.",
  "error.provider.cliBusySignOut":
    "Die {provider}-CLI arbeitet an einem Zug. Warte, bis er fertig ist, und trenne dann.",
  "error.provider.opencodeCredentialsRejected":
    "Der Modellanbieter hat den API-Schlüssel abgelehnt. Korrigiere den OpenCode-Schlüssel in den Einstellungen oder den Anbieterschlüssel mit `opencode auth login`. Versuche es dann erneut oder wähle ein anderes Modell.\n{detail}",
  "error.provider.opencodeAuthRequired":
    "OpenCode hat keine Anmeldung für den Modellanbieter „{provider}“. Wähle ein Modell mit der Markierung „Kostenlos“ oder verbinde den Anbieter: Füge einen OpenCode-Go-Schlüssel in den OpenCode-Einstellungen ein oder führe `opencode auth login` in einem Terminal aus. Versuche es dann erneut.",
  "error.provider.opencodeAuthRequiredUnknown":
    "OpenCode hat keine Anmeldung für den Anbieter dieses Modells. Wähle ein Modell mit der Markierung „Kostenlos“ oder verbinde den Anbieter: Füge einen OpenCode-Go-Schlüssel in den OpenCode-Einstellungen ein oder führe `opencode auth login` in einem Terminal aus. Versuche es dann erneut.",
  "error.provider.opencodeKeyExpired":
    "Dein OpenCode-API-Schlüssel ist abgelaufen. Erstelle in der OpenCode Console einen neuen Schlüssel, füge ihn in den OpenCode-Einstellungen ein und versuche es dann erneut.",
  "error.provider.opencodeServiceFailure":
    "OpenCode konnte diesen Durchlauf nicht abschließen, da sein lokaler Dienst fehlgeschlagen ist. Versuche es erneut. Falls der Fehler weiter auftritt, verbinde OpenCode in den Einstellungen erneut.",
  "error.provider.opencodeRateLimited":
    "Der Modellanbieter hat die Anfrage wegen seiner Ratenbegrenzung abgelehnt. Warte einige Minuten oder wähle ein anderes Modell und versuche es erneut.\n{detail}",
  "error.provider.opencodeBilling":
    "Der Modellanbieter hat die Anfrage wegen der Kontoabrechnung abgelehnt. Warten behebt dies nicht. Füge im Anbieterkonto eine Zahlungsmethode oder Guthaben hinzu oder wähle ein anderes Modell.\n{detail}",
  "error.provider.opencodeInvalidUpload":
    "Der Modellanbieter von OpenCode hat eine ungültige Upload-Anfrage gemeldet. Wähle ein anderes Modell und fahre fort. Prüfe gespeicherte Routinen, bevor du sie erneut erstellst.\n{detail}",
  "error.provider.opencodeUnreadableContent":
    "Dieses Modell kann eine Datei oder ein Bild in diesem Chat nicht lesen. Wähle ein Modell, das Dateien lesen kann, und sende deine Nachricht dann erneut.",
  "error.provider.opencodeFreeLimit":
    "Die kostenlosen OpenCode-Modelle haben ihr Nutzungslimit erreicht. Alle kostenlosen Modelle teilen sich dieses Limit. Um weiterzumachen, füge einen OpenCode-Go-Schlüssel in den OpenCode-Einstellungen ein oder wähle ein Modell eines anderen Anbieters.",
  "error.provider.opencodeProviderFailed":
    "Beim Modellanbieter ist ein Fehler aufgetreten. Deine Verbindung ist nicht die Ursache. Versuche es später erneut oder wähle ein anderes Modell.\n{detail}",
  "error.provider.opencodeNetwork":
    "OpenCode konnte keine Verbindung zum Modellanbieter herstellen. Prüfe die Netzwerkverbindung des Computers, auf dem OpenBot läuft, und versuche es erneut.\n{detail}",
  "error.provider.opencodeDatabaseNewer":
    "OpenCode konnte seine Datenbank nicht öffnen, weil eine neuere OpenCode-Version sie geändert hat. Aktualisiere OpenCode auf Version 2 oder neuer und versuche es dann erneut.",
  "error.provider.opencodeNoAnswer":
    "Das OpenCode-Modell hat den Durchlauf ohne Antwort beendet. Versuche es erneut oder wähle ein anderes Modell.",
  "error.provider.opencodeReasoningWithoutAnswer":
    "Das OpenCode-Modell hat den Durchlauf nach seinem Nachdenken ohne Antwort beendet. Versuche es erneut oder wähle ein anderes Modell.",
  "error.provider.chatgptPageFailed": "OpenBot konnte die ChatGPT-Verbindungsseite nicht öffnen.",
  "error.provider.noneReady": "Kein Agentenanbieter ist bereit.",
  "error.provider.claudeTurnActive":
    "Warte auf den Abschluss des aktiven Claude-Durchlaufs, bevor du seinen Kontext aktualisierst.",
  "error.provider.codexLoginRequired":
    "Codex erfordert eine Anmeldung mit einem ChatGPT-Abonnement. Führe `codex login` aus.",
  "error.provider.cliUpdateFailed": "OpenBot konnte die CLI von {provider} nicht aktualisieren. {reason}",
  "error.provider.tryAgain": "Versuche es erneut.",
  "error.provider.noAgentProcess": "{provider} hat keinen laufenden Prozess für diesen Agenten.",
  "error.provider.stoppedBeforeAgentProcess": "{provider} wurde gestoppt, bevor der Agentenprozess gestartet wurde.",
  "error.provider.archiveUnreadable":
    "Das Laufzeitarchiv kann nicht gelesen werden oder verwendet ein nicht unterstütztes Format.",
  "error.provider.antigravityArchivePath": "Das Gemini-Archiv enthält eine unerwartete Datei.",
  "error.provider.antigravityChecksum": "Die Prüfsumme der Gemini-Laufzeit stimmt nicht überein.",
  "error.provider.antigravityReleaseShape": "Die Gemini-Version hat eine unerwartete Struktur.",
  "error.provider.antigravityMissing":
    "Gemini wurde nicht heruntergeladen. Lade es in OpenBot herunter, um fortzufahren.",
  "error.provider.antigravityNotStarted":
    "Der Gemini-Server wurde gefunden, aber seine Version kann nicht gelesen werden.",
  "error.provider.antigravityVersionUnreadable": "Die Version des Gemini-Servers konnte nicht gelesen werden.",
  "error.provider.antigravitySignIn": "Melde dich mit Google an, um Gemini zu verwenden.",
  "error.provider.antigravityRateLimited":
    "Gemini hat die Anfrage abgelehnt, weil ein Ratenlimit oder das Kontingent des Tarifs erreicht ist. Warte ein paar Minuten oder wähle ein anderes Modell und versuche es dann erneut.\n{detail}",
  "error.provider.antigravityQuotaReached":
    "Google meldet, dass ein Gemini-Nutzungslimit erreicht ist. Das Limit kann für ein einzelnes Modell gelten, daher kann die Nutzungsseite deines Tarifs noch Rest anzeigen. Wähle ein anderes Gemini-Modell oder warte auf das Zurücksetzen.\n{detail}",
  "error.provider.antigravityModelUnavailable":
    "Gemini kann dieses Modell gerade nicht verwenden. Wähle ein anderes Modell und versuche es dann erneut.\n{detail}",
  "error.provider.antigravityServiceFailure":
    "Der Gemini-Dienst von Google hat die Anfrage nicht abgeschlossen. Versuche es in ein paar Minuten erneut.\n{detail}",
  "error.provider.cursorArchivePath": "Das Cursor-Archiv enthält eine unerwartete Datei.",
  "error.provider.cursorChecksum": "Die Prüfsumme der Cursor-Laufzeit stimmt nicht überein.",
  "error.provider.cursorReleaseShape": "Die Cursor-Version hat eine unerwartete Struktur.",
  "error.provider.cursorMissing": "Cursor wurde nicht heruntergeladen. Lade es in OpenBot herunter, um fortzufahren.",
  "error.provider.cursorNotStarted": "Der Cursor-Agent wurde gefunden, aber seine Version kann nicht gelesen werden.",
  "error.provider.cursorVersionUnreadable": "Die Version des Cursor-Agenten konnte nicht gelesen werden.",
  "error.provider.cursorSignIn": "Melde dich mit Cursor an oder setze CURSOR_API_KEY, um Cursor zu verwenden.",
  "error.provider.clineArchivePath": "Das Cline-Archiv hat einen unerwarteten Pfad.",
  "error.provider.clinePackageMismatch": "Das Cline-Paket stimmt nicht mit dem Laufzeitkatalog überein.",
  "error.provider.clineChecksum": "Die Prüfsumme der Cline-Laufzeit stimmt nicht überein.",
  "error.provider.clineLicenseChecksum": "Die Prüfsumme der Cline-Lizenz stimmt nicht überein.",
  "error.provider.clineMissing": "Cline wurde nicht heruntergeladen. Lade es in OpenBot herunter, um fortzufahren.",
  "error.provider.clineOutdated": "Cline CLI {version} ist zu alt. OpenBot benötigt 3.0.68 oder neuer.",
  "error.provider.clineNotStarted": "Cline konnte nicht starten. Führe `cline --version` in einem Terminal aus.",
  "error.provider.clineVersionUnreadable": "Die Version von Cline CLI konnte nicht gelesen werden.",
  "error.provider.clineSignIn": "Melde dich mit Cline an oder setze CLINE_API_KEY, um Cline zu verwenden.",
  "error.provider.usageLimitReached": "Das Konto hat sein Nutzungslimit erreicht.",
  "error.provider.foreignReasoning":
    "{provider} hat die früheren Überlegungen in diesem Chat nicht akzeptiert, da ein anderes Konto oder ein anderer API-Schlüssel sie erhalten hat. OpenBot hat eine neue {provider}-Sitzung mit dem Chatverlauf gestartet. Versuche es erneut.",
  "error.provider.opencodeSessionRejected":
    "OpenCode hat die Anfrage abgelehnt und keinen Grund genannt. Das kann in einem langen Chat oder nach einem Modellwechsel passieren. OpenBot hat eine neue OpenCode-Sitzung mit dem Chatverlauf gestartet. Versuche es erneut. Wenn der Fehler bleibt, wähle ein anderes Modell oder einen niedrigeren Aufwand.",
  "error.provider.museMcpStartupFault":
    "Muse konnte einen MCP-Server nicht starten und hat MCP in dieser Sitzung gesperrt. OpenBot hat eine neue Muse-Sitzung mit dem Chatverlauf gestartet. Versuche es erneut. Wenn der Fehler bleibt, schalte Computersteuerung oder den fehlerhaften MCP-Server für diesen Agenten aus.",
  "error.provider.grokSignIn": "Führe `grok login` aus oder setze XAI_API_KEY, um Grok zu verwenden.",
  "error.provider.acpSignInTimedOut": "Die Zeit für die Anmeldung ist abgelaufen.",
  "error.provider.acpSignInStopped": "Die Anmeldung wurde vor dem Abschluss gestoppt.",
  "error.provider.geminiBrowserUnavailable":
    "Gemini konnte die Anmeldeseite nicht öffnen. Installiere einen Browser und xdg-utils und verbinde dich dann aus einer Desktop-Sitzung auf diesem Host. Ein Server ohne Desktop kann diese Anmeldung nicht abschließen.",
  "error.provider.geminiBrowserOpenFailed":
    "Gemini konnte die Anmeldeseite nicht in deinem Browser öffnen. Prüfe deinen Standardbrowser und verbinde dich dann erneut.",
  "error.provider.acpSignInFailed": "Die Anmeldung wurde nicht abgeschlossen.",
  "error.provider.acpSignInFailedReason": "Die Anmeldung wurde nicht abgeschlossen: {reason}",
  "error.provider.acpSignInMethodMissing":
    "Dieser Anbieter bietet diese Anmeldung auf diesem Computer nicht an. Aktualisiere den Anbieter und versuche es dann erneut.",
  "error.provider.httpsSignInLinkOnly": "Im Browser können nur HTTPS-Anmeldelinks geöffnet werden.",
  "error.provider.geminiKeyRefused":
    "Gemini hat den gespeicherten API-Schlüssel abgelehnt. Ersetze oder entferne den Schlüssel in den Einstellungen und verbinde dich dann erneut.",
  "error.provider.keyProviderRefused":
    "{provider} hat den gespeicherten API-Schlüssel abgelehnt. Ersetze oder entferne den Schlüssel in den Einstellungen und versuche es dann erneut.",
  "error.provider.keyProviderNoBalance":
    "Das {provider}-Konto des gespeicherten API-Schlüssels hat kein Guthaben. Lade Guthaben auf das Konto und versuche es dann erneut.",
  "error.provider.messageTooLarge":
    "OpenBot hat {provider} gestoppt, da eine Nachricht mit mehr als {limit} MB gesendet wurde.",
  "error.provider.customAgentIdInvalid":
    "Eine Agenten-ID darf nur Kleinbuchstaben, Ziffern oder `-` enthalten und darf nicht die ID eines integrierten Anbieters sein.",
  "error.provider.customAgentEnvInvalid":
    "Ein Variablenname darf nur Buchstaben, Ziffern oder `_` enthalten und nicht mit einer Ziffer beginnen. Verwende jeden Namen einmal und höchstens 16 Namen.",
  "error.provider.customAgentUsagePromptInvalid": "Ein Nutzungsbefehl muss eine Zeile mit höchstens 256 Zeichen sein.",
  "error.provider.customAgentCommandInvalid":
    "Der Befehl muss ein vollständiger Pfad, ein mit ~/ beginnender Pfad oder ein Befehlsname ohne Leerzeichen sein.",
  "error.provider.customAgentArgsInvalid":
    "Ein Argument darf keinen Zeilenumbruch enthalten. Verwende höchstens 32 Argumente.",
  "error.provider.customAgentWindowsScript":
    "Ein .cmd- oder .bat-Befehl erlaubt in seinen Argumenten nur Buchstaben, Zahlen und - _ . , : = @ + / \\.",
  "error.provider.customAgentNotFound":
    "OpenBot kann {command} nicht finden. Gib den vollständigen Pfad des Befehls ein.",
  "error.provider.customAgentCheckTimedOut": "Der Agent hat innerhalb von 20 Sekunden nicht geantwortet.",
  "error.provider.customAgentCheckStopped": "Der Agent wurde gestoppt, bevor er geantwortet hat.",
  "error.provider.customAgentProtocolVersion":
    "Der Agent verwendet ACP-Version {version}. OpenBot verwendet Version 1.",
  "error.provider.customAgentCheckFailed": "Der Agent hat nicht als ACP-Agent geantwortet.",
  "error.provider.customAgentRemoveBusy":
    "Warte, bis der aktive Durchlauf und die Warteschlange abgeschlossen sind, bevor du diesen benutzerdefinierten Agenten entfernst.",
  "error.provider.customAgentNone": "Es ist kein benutzerdefinierter Agent gespeichert.",
  "error.provider.customAgentMissing":
    "Dieser benutzerdefinierte Agent ist derzeit nicht gespeichert. Wähle ein anderes Modell.",
  "error.provider.customAgentSignIn": "Melde dich mit dem eigenen Befehl des Agenten an und versuche es erneut.",
  "error.provider.customAgentsReadOnly":
    "Die gespeicherten benutzerdefinierten Agenten wurden mit einer neueren OpenBot-Version geschrieben oder die Datei kann nicht gelesen werden. Aktualisiere OpenBot, um sie zu ändern.",
  "error.provider.customAgentNoSecureStorage":
    "Dieser Computer hat keinen sicheren Speicher. Umgebungswerte können daher nicht gespeichert werden. Entferne sie und versuche es erneut.",
  "error.provider.customAgentNotSaved":
    "Dieser benutzerdefinierte Agent ist nicht gespeichert. Aktualisiere die Liste und versuche es erneut.",
  "error.provider.customAgentTooMany": "Du kannst höchstens {count} benutzerdefinierte Agenten speichern.",
  "error.provider.customAgentEnvValueMissing": "Gib einen Wert für {name} ein.",
  "error.provider.off":
    "{provider} ist in OpenBot ausgeschaltet. Schalte den Anbieter zuerst in den Anbietereinstellungen ein.",
  "error.provider.inUse": "Ein Agent verwendet {provider}. Ändere sein Modell, bevor du diesen Anbieter ausschaltest.",
  "error.provider.useBusy": "Warte, bis die Anbieterprüfung oder Anmeldung abgeschlossen ist, und versuche es erneut.",
  "error.provider.useSettingsReadOnly":
    "Die gespeicherten Anbietereinstellungen können nicht gelesen werden. Aktualisiere OpenBot, bevor du sie änderst.",
  "error.provider.useChangeFailed": "OpenBot konnte die Anbietereinstellung nicht ändern.",
  "error.provider.accountsUnsupported": "{provider} unterstützt nur ein Konto.",
  "error.provider.accountNeedsConnection": "Verbinde {provider}, bevor du ein weiteres Konto hinzufügst.",
  "error.provider.usageResetUnsupported": "{provider} kann Nutzungslimits nicht zurücksetzen.",
  "error.provider.signOutUnsupported": "OpenBot kann die {provider}-Anmeldung nicht trennen.",
  "error.provider.usageResetNotConnected":
    "Melde dich erneut bei diesem {provider}-Konto an, bevor du seine Nutzung zurücksetzt.",
  "error.provider.accountLimit": "{provider} unterstützt höchstens {limit} Konten.",
  "error.provider.accountNotFound":
    "Dieses {provider}-Konto ist nicht auf diesem Computer. Aktualisiere und versuche es erneut.",
  "error.provider.accountAlreadyAdded": "Dieses {provider}-Konto ist bereits verbunden.",
  "error.provider.accountDefault": "Das erste {provider}-Konto kann nicht entfernt werden.",
  "error.provider.accountUsesKey":
    "Dieses {provider}-Konto verwendet den gespeicherten API-Schlüssel und hat keine Anmeldung. Ändere den Schlüssel in Servereinstellungen → Anbieter.",
  "error.provider.accountInUse":
    "Ein Agent mit diesem Konto arbeitet gerade. Versuche es erneut, wenn der Agent anhält.",
  "error.provider.accountsReadOnly":
    "Die gespeicherten Anbieterkonten können nicht gelesen werden. Aktualisiere OpenBot, bevor du sie änderst.",
  "error.provider.accountSignedOut": "Dieses {provider}-Konto ist abgemeldet. Melde dich erneut an.",
  "error.provider.sessionSettingUnavailable": "Diese Einstellung ist in der aktuellen Anbietersitzung nicht verfügbar.",
  "error.provider.sessionSettingInvalid": "Dieser Wert ist für die Einstellung nicht verfügbar.",
  "error.provider.sessionSettingsBusy":
    "Warte, bis der aktuelle Durchlauf endet, bevor du eine Sitzungseinstellung änderst.",
  "error.provider.piOutdated":
    "Pi {version} ist zu alt. Installiere Pi 1.1.0 oder neuer für native RPC- und MCP-Unterstützung.",
  "error.provider.nativeMissing": "Die {provider} CLI ist nicht installiert. Lade sie in den Einstellungen herunter.",
  "error.provider.nativeNotStarted": "Die {provider} CLI konnte nicht starten.",
  "error.provider.nativeVersionUnreadable": "Die Version der {provider} CLI konnte nicht gelesen werden.",
  "error.provider.piSessionBusy": "Warte, bis der aktuelle Pi-Durchlauf endet.",
  "error.provider.piStopped": "Pi läuft nicht. Verbinde Pi und versuche es erneut.",
  "error.provider.piSessionMissing": "Die Pi-Sitzungsdatei ist auf diesem Computer nicht verfügbar.",
  "error.provider.piResumeCancelled": "Pi hat das Fortsetzen der Sitzung abgebrochen. Versuche es erneut.",
  "error.provider.piSessionIdentity":
    "Pi hat eine andere Sitzung zurückgegeben. Die gespeicherte Sitzung wurde nicht ersetzt.",
  "error.provider.piModelInvalid": "Wähle ein Pi-Modell, das seinen Anbieter enthält.",
  "error.provider.piToolInvalid": "Das Werkzeug hat ein ungültiges Ergebnis zurückgegeben.",
  "error.provider.piSignIn":
    "Verwende /login in Pi auf dem Host-Computer. Schließe Pi, wenn die Anmeldung abgeschlossen ist.",
  "error.provider.museBusy": "Die Muse-Sitzung ist beschäftigt.",
  "error.provider.museStopped": "Der Muse-Client läuft nicht.",
  "error.provider.museUnexpectedProvider": "Muse hat einen unerwarteten Modellanbieter zurückgegeben.",
  "error.provider.museNoActiveTurn": "Muse hat keinen aktiven Durchlauf zum Steuern.",
  "error.provider.museInvalidProtocol": "Muse hat eine ungültige Protokollantwort zurückgegeben.",
  "error.provider.museNotStarted": "Muse wurde nicht gestartet.",
  "error.provider.museNativeWindows": "Muse benötigt unter Windows eine native ausführbare Datei.",
  "error.provider.museStartTimeout": "Die Initialisierung von Muse hat zu lange gedauert.",
  "error.provider.museStartStopped": "Muse wurde während der Initialisierung beendet.",
  "error.provider.museProtocolVersion": "Nicht unterstützte Muse-Protokollversion.",
  "error.provider.museHistoryRequired": "Muse muss den Sitzungsverlauf behalten.",
  "error.provider.museRequestUnsupported": "Nicht unterstützte Muse-Serveranfrage.",
  "error.provider.museConnectionFailed":
    "Die Verbindung zu Muse ist fehlgeschlagen. Setze die Unterhaltung fort, um ihren gespeicherten Verlauf wiederherzustellen.",
  "error.provider.museUnknownSession": "Unbekannte Muse-Sitzung.",
  "error.provider.museInvalidToolResult": "Ungültiges OpenBot-Werkzeugergebnis.",
  "error.provider.museMcpRequired": "Muse muss MCP-Server pro Sitzung unterstützen.",
  "error.provider.museSessionMismatch": "Muse hat eine andere Sitzung zurückgegeben.",
  "error.provider.museCompactRejected": "Muse hat die Komprimierung nicht akzeptiert.",
  "error.provider.museTurnMismatch": "Muse hat einen anderen Durchlauf zurückgegeben.",
  "error.provider.museHistoryMismatch": "Der Muse-Verlauf hat Sitzungen überschritten.",
  "error.provider.museRecoveryFailed": "Muse konnte die fehlenden Ereignisse nicht wiederherstellen.",
  "error.provider.museHistoryStalled": "Der Muse-Verlaufscursor ist nicht weitergerückt.",
  "error.provider.museApprovalUnavailable": "Muse hat diese Genehmigungsantwort nicht angeboten.",
  "error.provider.museHistoryOwner": "Der Muse-Verlauf gehört zu einer anderen Sitzung.",
  "error.provider.museHistoryMissing": "Muse hat keinen Sitzungsverlauf zurückgegeben.",
  "error.provider.museEmptyInput": "Muse benötigt Text oder ein Bild.",
  "error.provider.museMethodUnsupported": "Muse unterstützt {method} nicht.",
  "error.provider.museTurnFailed": "Der Muse-Durchlauf ist fehlgeschlagen.",
  "error.provider.museProfileUnsupported":
    "Muse kann ohne Zugriff auf externe Werkzeuge kein Profil erstellen. Verwende einen anderen Anbieter, um das Profil zu erstellen, und wähle dann Muse für den Agenten.",
  "error.provider.museAuthUnverified":
    "Die Muse-Authentifizierung ist nicht bestätigt. Verbinde dich auf dem Host-Computer oder lege einen Meta-API-Schlüssel fest.",
  "error.provider.museSignIn": "Melde dich auf dem Host-Computer bei Muse an, um fortzufahren.",
  "error.provider.inceptionSignIn": "Füge einen Inception-API-Schlüssel hinzu, um fortzufahren.",
  "error.provider.deepseekSignIn": "Füge einen DeepSeek-API-Schlüssel hinzu, um fortzufahren.",
  "error.provider.openrouterSignIn": "Füge einen OpenRouter-API-Schlüssel hinzu, um fortzufahren.",
  "error.provider.terminalLoginFailed":
    "Das Anmeldeterminal konnte nicht geöffnet werden. Öffne die Anbieter-CLI auf diesem Host, melde dich dort an und aktualisiere dann die Anbieter.",
  "error.provider.nativeArchiveInvalid": "Der Anbieter-Download enthält keine gültige Installation.",
  "error.provider.nativeChecksum": "Die Anbieterinstallation hat die Integritätsprüfung nicht bestanden.",
  "error.provider.registryUnavailable": "Die ACP-Registry ist nicht verfügbar. Versuche es erneut.",
  "error.provider.registryInvalid": "Die ACP-Registry hat ungültige Daten zurückgegeben.",
  "error.provider.registryMissing": "Dieser Agent ist nicht in der ACP-Registry.",
  "error.provider.registryBusy": "Für diesen Agenten läuft bereits eine Installation.",
  "error.provider.registryCancelled": "Die Installation des Agenten wurde abgebrochen.",
  "error.provider.registryPrerequisite": "Installiere {tool} auf dem Host, bevor du diesen Agenten installierst.",
  "error.provider.registryBindingChanged":
    "Der benutzerdefinierte Agent hat sich während der Installation geändert. Versuche es erneut.",
  "error.provider.registryInstallFailed":
    "Die Installation des Agenten ist fehlgeschlagen. Die vorherige Installation ist unverändert.",
  "error.provider.registryRemoveBusy":
    "Warte, bis die Installation des Agenten und laufende ACP-Arbeit abgeschlossen sind, bevor du ihn entfernst.",
} as const satisfies PartialTranslation<typeof source>;
