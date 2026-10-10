import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/backend";

export const messages = {
  "error.backend.eventsUnavailable": "Auf diesem Host sind keine Ereignisse verfügbar.",
  "error.backend.webhookRouteLimit": "Ein Host kann höchstens {limit} Webhook-Routinen haben.",
  "error.backend.webhookSettingsInvalid": "Prüfe die Webhook-Einstellungen und versuche es erneut.",
  "error.backend.webhookRouteUnavailable":
    "Die öffentliche Webhook-Route ist nicht bereit. Prüfe die Host-Verbindung und versuche es erneut.",
  "error.backend.browserViewRemoteOnly": "Eine Live-Browseransicht ist nur für einen entfernten Host verfügbar.",
  "error.backend.browserViewUnsupported": "Dieser entfernte Host unterstützt keine Live-Browseransicht.",
  "error.backend.browserViewLimit": "Auf diesem Host sind zu viele Browseransichten geöffnet.",
  "error.backend.browserViewEnded": "Die Live-Ansicht dieser Seite wurde beendet.",
  "error.backend.browserViewFailed": "Die Live-Ansicht dieser Seite ist fehlgeschlagen.",
  "error.backend.windowTemporarilyUnavailable": "Das OpenBot-Fenster ist vorübergehend nicht verfügbar.",
  "error.backend.windowUnavailable": "Das OpenBot-Fenster ist nicht verfügbar.",
  "error.backend.sunshineApiHttp": "Die Sunshine-API ist mit HTTP {status} fehlgeschlagen.",
  "error.backend.sunshinePortsUnavailable":
    "Für den Remote-Desktop konnte keine freie Sunshine-Portfamilie reserviert werden.",
  "error.backend.moonlightPortsUnavailable":
    "Für den Remote-Desktop konnte kein freier Moonlight-WebRTC-Portbereich reserviert werden.",
  "error.backend.iceServerNoPort": "Der ICE-Server des Remote-Desktops hat keinen Port erhalten.",
  "error.backend.remoteDesktopStoppedWhileStarting": "Die Remote-Desktop-Laufzeit wurde während des Starts gestoppt.",
  "error.backend.sunshineNotStarted": "Sunshine wurde nicht auf einer reservierten Portfamilie gestartet.",
  "error.backend.moonlightNoHost": "Moonlight hat keinen gekoppelten lokalen Host.",
  "error.backend.sunshineNoDesktop": "Sunshine hat die Anwendung Desktop nicht veröffentlicht.",
  "error.backend.sunshineAmbiguousPairing": "Sunshine hat mehrdeutige lokale Kopplungsanfragen zurückgegeben.",
  "error.backend.sunshineNoPairingRequest": "Sunshine hat die erwartete lokale Kopplungsanfrage nicht erhalten.",
  "error.backend.moonlightPairingHttp": "Die Moonlight-Kopplung ist mit HTTP {status} fehlgeschlagen.",
  "error.backend.moonlightRejectedPairing": "Moonlight hat die Kopplung mit Sunshine abgelehnt.",
  "error.backend.moonlightNoPin": "Moonlight hat keine Kopplungs-PIN zurückgegeben.",
  "error.backend.moonlightPairingIncomplete": "Die Moonlight-Kopplung wurde nicht abgeschlossen.",
  "error.backend.moonlightWebNotEmbedded": "Moonlight Web ist keine in OpenBot eingebettete Version.",
  "error.backend.moonlightEmptyResponse": "Moonlight hat eine leere Antwort zurückgegeben.",
  "error.backend.remoteDesktopTimeout": "Die Zeit für die Remote-Desktop-Anfrage ist abgelaufen.",
  "error.backend.moonlightApiHttp": "Die Moonlight-API ist mit HTTP {status} fehlgeschlagen.",
  "error.backend.sunshineExited": "Sunshine wurde beendet, bevor seine HTTPS-API auf Port {port} bereit war.",
  "error.backend.sunshineNoAnswer": "Sunshine hat nicht geantwortet.",
  "error.backend.sunshineTlsUnexpected": "Sunshine hat ein unerwartetes TLS-Zertifikat zurückgegeben.",
  "error.backend.moonlightWebExited": "Moonlight Web wurde beendet, bevor {url} bereit war.",
  "error.backend.moonlightWebNotReady": "Moonlight Web wurde nicht bereit.",
  "error.backend.channelDeleteUnsupported": "Dieser Server unterstützt das Löschen von Kanälen nicht.",
  "error.backend.browserNavigateUnsupported":
    "Dieser entfernte Host unterstützt die Navigation über die Adressleiste in einem vorhandenen Tab nicht.",
  "error.backend.sharedDataLocalOnly":
    "Geteilte Daten werden auf dem Computer verwaltet, auf dem diese Agenten laufen.",
  "error.backend.browserUrlProtocol": "Im Browser sind nur HTTP(S)-URLs erlaubt.",
  "error.backend.sunshineNotReady": "Sunshine wurde nicht bereit.",
  "error.backend.sunshineNotReadyReason": "Sunshine wurde nicht bereit. {reason}",
  "error.backend.channelLeadModelUnavailable": "Das Modell der Kanalleitung ist nicht verfügbar.",
  "error.backend.sharedDataUnavailable": "Geteilte Daten sind nicht verfügbar.",
  "error.backend.shuttingDown": "OpenBot wird beendet.",
  "error.backend.channelUnconfirmedStart":
    "Im Kanal gibt es einen unbestätigten Auftragsstart. Prüfe das Ergebnis, bevor du den Kanal löschst.",
  "error.backend.channelNotFound": "Kanal nicht gefunden.",
  "error.backend.channelMemberUnavailable": "Ein Kanalmitglied ist nicht verfügbar.",
  "error.backend.channelArchived":
    "Stelle diesen Kanal wieder her, bevor du Nachrichten sendest oder Aufgaben änderst.",
  "error.backend.channelReferenceUnavailable": "Die referenzierte Kanalnachricht ist nicht verfügbar.",
  "error.backend.channelTaskNotFound": "Kanalaufgabe nicht gefunden.",
  "error.backend.channelTaskComplete": "Diese Aufgabe ist bereits abgeschlossen.",
  "error.backend.channelSelectAgent": "Wähle einen Agenten.",
  "error.backend.channelLeadRequired": "Wähle eine verfügbare Kanalleitung oder weise diese Aufgabe einem Mitglied zu.",
  "error.backend.channelRoutingTooLong":
    "Diese Anfrage überschreitet die Kontextgrenze für die Zuweisung. Wähle ein Mitglied oder sende eine kürzere Anfrage.",
  "error.backend.channelTaskMemberRequired": "Wähle ein Mitglied für diese Aufgabe.",
  "error.backend.channelRequestMemberRequired": "Wähle ein Mitglied für diese Anfrage.",
  "error.backend.channelDeliveryNotCreated": "Die Kanalzustellung wurde nicht erstellt.",
  "error.backend.channelAssignmentStopped": "Dieser Kanalauftrag wurde gestoppt oder ersetzt.",
  "error.backend.channelAssigneeUnavailable": "Der zugewiesene Agent ist nicht verfügbar.",
  "error.backend.channelAssignmentChanged": "Dieser Kanalauftrag wurde geändert.",
  "error.backend.channelMemberRequired": "Wähle ein verfügbares Mitglied dieses Kanals.",
  "error.backend.memoryEssentialBudget":
    "Die wesentlichen Erinnerungen überschreiten das Prompt-Limit. Stelle einen Eintrag auf „Bei Bedarf suchen“ und versuche es erneut.",
  "error.backend.memorySelectionConflict": "Die Erinnerung hat sich geändert. Lade sie neu und versuche es erneut.",
  "error.backend.memorySelectionUserControlled":
    "Der Nutzer steuert diese Auswahl der Erinnerung. Behalte die Wahl des Nutzers bei.",
  "error.backend.memorySearchQuery": "Gib ein oder mehrere Suchwörter mit bis zu 256 Zeichen ein.",
  "error.backend.memoryOperationFailed": "Der Vorgang für die Erinnerung ist fehlgeschlagen. Versuche es erneut.",
  "error.backend.memoryGone": "Diese Erinnerung existiert nicht mehr.",
  "error.backend.routineGone": "Diese Routine existiert nicht mehr.",
  "error.backend.channelMemoryLimit": "Ein Kanal kann bis zu {limit} Erinnerungen haben.",
  "error.backend.channelRoutineLimit": "Ein Kanal kann höchstens {limit} Routinen haben.",
  "error.backend.agentRoutineLimit": "Ein Agent kann höchstens {limit} Routinen haben.",
  "error.backend.agentMemoryLimit": "Ein Agent kann bis zu {limit} Erinnerungen haben.",
  "error.backend.agentMemoryLimitReached":
    "Du hast {saved} von {limit} Erinnerungen. Um Platz zu schaffen, aktualisiere eine Erinnerung über ihre memoryId mit dem kombinierten Text zweier verwandter Erinnerungen und vergiss dann die andere, oder vergiss eine Erinnerung, die nicht mehr stimmt. Versuche es dann erneut.",
  "error.backend.agentMemoryLimitExceeded":
    "Du hast {saved} Erinnerungen, und das Limit ist {limit}. Der Benutzer hat das Limit unter die Zahl der gespeicherten Erinnerungen gesetzt. Vergiss keine Erinnerungen, um Platz zu schaffen. Sag dem Benutzer, dass diese Erinnerung nicht gespeichert wurde.",
  "error.backend.channelHistoryLeadRequired": "Wähle eine Kanalleitung, um den geteilten Verlauf vorzubereiten.",
  "error.backend.channelHistoryArriving":
    "Eine geteilte Nachricht wird noch empfangen. Setze fort, wenn sie vollständig ist.",
  "error.backend.channelHistoryInvalid":
    "Die Zusammenfassung des Verlaufs ist ungültig. Setze fort, um es erneut zu versuchen.",
  "error.backend.channelContextTooLong":
    "Dieser Auftrag überschreitet die Grenze des geteilten Kontexts. Sende eine kürzere Anfrage oder weise ihn neu zu.",
  "error.backend.draftAttachmentLimit": "Behalte höchstens {limit} Anhangsentwürfe.",
  "error.backend.recipientRequired": "Mindestens ein Empfänger ist erforderlich.",
  "error.backend.recipientLimit": "Eine Nachricht kann höchstens {limit} Empfänger haben.",
  "error.backend.attachmentDraftGone": "Der Anhangsentwurf existiert nicht mehr: {id}",
  "error.backend.attachmentInQueueEdit": "Ein Anhang gehört zu einer Bearbeitung der Warteschlange.",
  "error.backend.messageEmpty": "Die Nachricht darf nicht leer sein.",
  "error.backend.attachLimit": "Hänge höchstens {limit} Dateien an.",
  "error.backend.queuedMessageNotFound": "Die Nachricht in der Warteschlange wurde nicht gefunden.",
  "error.backend.cancelQueuedOnly": "Nur Nachrichten in der Warteschlange können storniert werden.",
  "error.backend.messageBeingEdited":
    "Diese Nachricht wird bearbeitet. Speichere die Bearbeitung zuerst oder brich sie ab.",
  "error.backend.queuedMessageUnavailable": "Diese Nachricht in der Warteschlange ist nicht mehr verfügbar.",
  "error.backend.editedOnOtherDevice": "Diese Nachricht wird auf einem anderen Gerät bearbeitet.",
  "error.backend.editUnavailable": "Diese Bearbeitung ist nicht mehr verfügbar.",
  "error.backend.attachmentInOtherEdit": "Ein Anhang gehört zu einer anderen Bearbeitung.",
  "error.backend.messageBeingSaved": "Diese Nachricht wird gespeichert. Versuche es nach Abschluss erneut.",
  "error.backend.editQueuedOnly": "Nur Nachrichten in der Warteschlange können bearbeitet werden.",
  "error.backend.attachmentNotInMessage": "Ein Anhang gehört nicht zur Nachricht in der Warteschlange.",
  "error.backend.queueOrderStale":
    "Die Reihenfolge der Warteschlange ist veraltet. Aktualisiere die Warteschlange und versuche es erneut.",
  "error.backend.fileGone": "Die Datei existiert nicht oder wurde bereits gelöscht.",
  "error.backend.managedAttachmentChanged": "Der verwaltete Anhang fehlt oder wurde geändert: {name}",
  "error.backend.mailboxStateCorrupt":
    "Der Postfachzustand ist beschädigt oder stammt aus einer neueren OpenBot-Version. Er wird nicht überschrieben.",
  "error.backend.recipientDeleting":
    "Der Empfänger wird gelöscht. Versuche es nach Abschluss des Löschvorgangs erneut.",
  "error.backend.attachBetween": "Hänge zwischen 1 und {limit} Dateien an.",
  "error.backend.attachmentNotFile": "Der Anhang ist keine Datei: {path}",
  "error.backend.generatedImageTooLarge": "Das erstellte Bild überschreitet die Grenze von 100 MB.",
  "error.backend.attachmentNotRegularFile": "Nur reguläre Dateien können angehängt werden: {name}",
  "error.backend.attachmentCopyFailed": "OpenBot konnte {name} nicht kopieren.",
  "error.backend.routineNameRequired": "Ein Name für die Routine ist erforderlich.",
  "error.backend.routineNameTooLong": "Der Name der Routine ist zu lang.",
  "error.backend.routineInstructionRequired": "Eine Anweisung für die Routine ist erforderlich.",
  "error.backend.routineInstructionTooLong": "Die Anweisung der Routine ist zu lang.",
  "error.backend.routineScheduleInvalid": "Der Zeitplan der Routine ist ungültig.",
  "error.backend.routineIntervalTooShort":
    "Routinenintervalle müssen mindestens {minutes} Minuten betragen. Verwende {minutes} Minuten oder mehr oder einen täglichen, wöchentlichen oder cron-Zeitplan.",
  "error.backend.routineIntervalTooShortFixed":
    "Routinenintervalle müssen mindestens {minutes} Minuten betragen. Verwende {minutes} Minuten oder mehr oder eine feste Uhrzeit.",
  "error.backend.routineCronTooOften":
    "Benutzerdefinierte Zeitpläne dürfen höchstens alle {minutes} Minuten ausgeführt werden.",
  "error.backend.routineAnchorInvalid": "Der Startpunkt des Routinenintervalls ist ungültig.",
  "error.backend.routineNoOccurrence": "Der Zeitplan enthält in den nächsten fünf Jahren keine Ausführung.",
  "error.backend.routineTimezoneInvalid": "Die Zeitzone der Routine ist ungültig.",
  "error.backend.routineCronFields": "Benutzerdefinierte Zeitpläne müssen fünf cron-Felder verwenden.",
  "error.backend.routineCronValueInvalid": "Der cron-Wert {field} ist ungültig.",
  "error.backend.routineCronFieldEmpty": "Das cron-Feld {field} ist leer.",
  "error.backend.routineDeletionBusy": "Für diesen Agenten wird bereits eine andere Routine gelöscht.",
  "error.backend.routineWaitForAgent":
    "Warte, bis der Agentenvorgang abgeschlossen ist, bevor du eine Routine ausführst.",
  "error.backend.routineRunStarting":
    "Diese Routine wird noch gestartet. Versuche es erneut, sobald ihr Durchlauf beginnt.",
  "error.backend.routineRunNoSession":
    "OpenBot kann die aktive Routinen-Ausführung nicht unterbrechen, da ihre Anbietersitzung nicht verfügbar ist.",
  "error.backend.interruptSelf": "Ein Agent kann sich nicht selbst unterbrechen.",
  "error.backend.interruptOtherWork":
    "Dieser Agent arbeitet an einer Aufgabe, die nicht durch deine Nachricht gestartet wurde. Nur der Benutzer oder der Absender dieser Aufgabe kann ihn stoppen.",
  "error.backend.interruptStarting":
    "Dieser Agent startet noch einen Durchlauf. Versuche es erneut, sobald der Durchlauf beginnt.",
  "error.backend.interruptNoSession":
    "OpenBot kann diesen Agenten nicht unterbrechen, da seine Anbietersitzung nicht verfügbar ist.",
  "error.backend.memoryTextRequired": "Ein Erinnerungstext ist erforderlich.",
  "error.backend.memoryTextTooLong": "Der Erinnerungstext ist zu lang.",
  "error.backend.mcpServerGone": "Dieser MCP-Server existiert nicht mehr.",
  "error.backend.routineFlowLinkGone": "Diese Verbindung existiert nicht mehr.",
  "error.backend.routineFlowSameAgent": "Ein Agent kann keine Arbeit an sich selbst übergeben.",
  "error.backend.routineFlowIntoOwner":
    "Die Routine beginnt mit ihrem eigenen Agenten. Dieser Agent kann daher keine Arbeit von einem anderen übernehmen.",
  "error.backend.routineFlowNotOnPath":
    "Dieser Agent gehört noch nicht zur Routine. Verbinde ihn zuerst mit der Routine.",
  "error.backend.routineFlowDuplicate": "Diese Agenten sind in dieser Routine bereits verbunden.",
  "error.backend.routineFlowCycle": "Diese Verbindung würde eine Schleife erzeugen.",
  "error.backend.routineFlowLinkLimit": "Eine Routine kann höchstens {limit} Verbindungen haben.",
  "error.backend.routineFlowHandoffFailed": "Die Routine konnte die Arbeit nicht an diesen Agenten übergeben.",
  "error.backend.routineFlowRemoteUnsupported": "Routinenabläufe sind nur für Agenten auf diesem Computer verfügbar.",
  "error.backend.mcpServerLimit": "OpenBot verwaltet bis zu {limit} MCP-Server.",
  "error.backend.mcpServerNameTaken": "Ein MCP-Server mit dem Namen {name} existiert bereits.",
  "error.backend.mcpServerNoAnswer": "Der Server hat innerhalb von {seconds} Sekunden nicht geantwortet.",
  "error.backend.mcpSignInNotAccepted": "Der Server hat diese Anmeldung nicht akzeptiert.",
  "error.backend.mcpCommandNotFound": "Befehl nicht gefunden: {command}",
  "error.backend.mcpRegistrationRefused":
    "Der Anmeldeserver akzeptiert OpenBot noch nicht als Anwendung. Dein Konto ist nicht die Ursache. Verwende eine andere Verbindungsmethode, etwa einen lokalen MCP-Server.",
  "error.backend.mcpSignInAbandonedGeneric": "Die Anmeldung wurde abgebrochen.",
  "error.backend.mcpSignInForgotten": "Die MCP-Anmeldung wurde während ihrer Ausführung verworfen.",
  "error.backend.mcpSignInAbandoned": "Die MCP-Anmeldung wurde abgebrochen.",
  "error.backend.mcpSignInNoBrowser": "Diese MCP-Anmeldung kann keinen Browser öffnen.",
  "error.backend.mcpSignInNotWebPage": "Die Anmeldeadresse ist keine Webseite.",
  "error.backend.mcpSignInRequired":
    "Dieser Server verlangt eine Anmeldung. Wähle „Anmelden“, um im Browser fortzufahren.",
  "error.backend.mcpSignInOnHost":
    "Dieser Server verlangt eine Anmeldung. Melde dich in OpenBot auf dem Host-Computer bei ihm an.",
  "error.backend.mcpSignInNeedsHttps":
    "Dieser Server verlangt eine Anmeldung, und OpenBot meldet sich nur über https an. Ändere die URL in {url}.",
  "error.backend.mcpSignInCancelled": "Die Anmeldung wurde abgebrochen.",
  "error.backend.mcpSignInTimedOut": "Die Anmeldung wurde im Browser nicht abgeschlossen.",
  "error.backend.mcpSignInResponseTimedOut": "Die Antwort auf die Anmeldung kam nicht rechtzeitig an.",
  "error.backend.mcpServerExited":
    "Der Server wurde beendet, bevor er geantwortet hat. Führe den Befehl in einem Terminal aus, um seinen Fehler zu sehen.",
  "error.backend.mcpServerUnreachable": "OpenBot konnte den Server nicht erreichen. Prüfe die URL und dein Netzwerk.",
  "error.backend.mcpLocalServerOff":
    "Unter {address} antwortet auf diesem Computer kein Server. Starte den Server oder schalte ihn in der App ein, die ihn ausführt, und versuche es dann erneut.",
  "error.backend.mcpServerBlocked":
    "Dieser Computer hat die Verbindung zum Server blockiert. Prüfe deine Firewall oder Sicherheitssoftware und versuche es dann erneut.",
  "error.backend.mcpServerIncompatible":
    "Unter dieser Adresse hat etwas geantwortet, aber nicht als MCP-Server über Streamable HTTP. Prüfe die URL und aktualisiere die App, die den Server ausführt.",
  "error.backend.mcpRemoteBridge":
    "{reason} Dieser Befehl startet die mcp-remote-Brücke. Wähle stattdessen Streamable HTTP mit der URL {url}, dann meldet OpenBot dich an.",
  "error.backend.oauthNotHttps":
    "Der OAuth-Endpunkt {origin} verwendet kein https. Die Zugangsdaten wurden daher nicht gesendet.",
  "error.backend.oauthTooManyRedirects": "Der OAuth-Endpunkt hat zu oft weitergeleitet.",
  "error.backend.oauthRedirectOrigin":
    "Der OAuth-Endpunkt hat zu {origin} weitergeleitet. Die Zugangsdaten wurden daher nicht weitergegeben.",
  "error.backend.sidebarSectionLimit": "Ein Server kann bis zu {limit} Seitenleistenabschnitte haben.",
  "error.backend.sectionNameRequired": "Ein Abschnittsname ist erforderlich.",
  "error.backend.sectionNameTooLong": "Der Abschnittsname ist zu lang.",
  "error.backend.sectionNameDuplicate": "Abschnittsnamen müssen eindeutig sein.",
  "error.backend.directMessageRequired": "Schreibe zuerst eine Nachricht.",
  "error.backend.directMessageTooLong": "Eine Direktnachricht kann bis zu {limit} Zeichen haben.",
  "error.backend.directMessageSelf": "Du kannst dir selbst keine Direktnachricht senden.",
  "error.backend.readBoundaryUnavailable": "Die Leseposition ist nicht mehr verfügbar.",
  "error.backend.sharedFileOutside": "Die geteilte Datei muss im geteilten Verzeichnis liegen.",
  "error.backend.sharedPathNotFile": "Der geteilte Pfad ist keine Datei.",
  "error.backend.workspaceFileOutside": "Die Arbeitsbereichsdatei muss im Arbeitsbereich des Agenten liegen.",
  "error.backend.workspacePathNotFile": "Der Arbeitsbereichspfad ist keine Datei.",
  "error.backend.workspacePathNotDirectory": "Der Arbeitsbereichspfad ist kein Ordner.",
  "error.backend.workspacePathMissing": "Unter {path} im Agentenarbeitsbereich {root} existiert nichts.",
  "error.backend.workspacePathMissingForMember": "Unter {path} im Agentenarbeitsbereich existiert nichts.",
  "error.backend.useChannelTaskControls": "Verwende für diesen Auftrag die Aufgabensteuerung des Kanals.",
  "error.backend.editFinished": "Diese Bearbeitung ist bereits abgeschlossen.",
  "error.backend.editCancelled":
    "Diese Bearbeitung wurde abgebrochen. Die Nachricht behält daher ihren ursprünglichen Text.",
  "error.backend.editSaved": "Diese Bearbeitung wurde bereits gespeichert.",
  "error.backend.editSavedDifferent":
    "Diese Bearbeitung wurde bereits mit anderem Inhalt gespeichert. Deine Änderungen wurden nicht gespeichert.",
  "error.backend.useChannelTaskControlsWork": "Verwende für Kanalarbeit die Aufgabensteuerung des Kanals.",
  "error.backend.steerTurnChanged":
    "Der aktive Durchlauf wurde geändert, bevor diese Nachricht eingesteuert werden konnte.",
  "error.backend.steerUnsupported":
    "Dieser Anbieter kann einen laufenden Durchgang nicht steuern. Deine Nachricht bleibt in der Warteschlange.",
  "error.backend.steerQueuedOnly": "Nur Nachrichten in der Warteschlange können eingesteuert werden.",
  "error.backend.promptInactive": "Diese Rückfrage ist nicht mehr aktiv.",
  "error.backend.promptAnswerMismatch": "Eine Antwort passt zu keiner aktiven Frage.",
  "error.backend.approvalInactive": "Diese Freigabe ist nicht mehr aktiv.",
  "error.backend.takeoverInactive": "Diese Browserübernahme ist nicht mehr aktiv.",
  "error.backend.authSubmitting": "Die Authentifizierung wird bereits übermittelt.",
  "error.backend.authRequestInactive": "Diese sichere Authentifizierungsanfrage ist nicht mehr aktiv.",
  "error.backend.secureAuthUnavailable": "Die sichere Authentifizierung ist nicht verfügbar.",
  "error.backend.browserUrlRequired": "Eine Browser-URL ist erforderlich.",
  "error.backend.browserUrlTooLong": "Die Browser-URL ist zu lang.",
  "error.backend.browserTabLimit": "Im Browser können bis zu {limit} Tabs geöffnet sein.",
  "error.backend.browserLowMemory":
    "Dieser Server hat wenig freien Arbeitsspeicher. Der Browser kann daher keinen weiteren Tab öffnen. Schließe einen Tab oder warte, bis andere Agenten fertig sind.",
  "error.backend.browserOpenFailed": "{url} konnte nicht geöffnet werden: {reason}",
  "error.backend.popupSecureInput":
    "Pop-ups sind während der sicheren Eingabe blockiert. Beende die sichere Eingabe oder brich sie ab und versuche es dann erneut auf der Seite.",
  "error.backend.popupUnsupportedType":
    "Dieser Pop-up-Typ wird nicht unterstützt. Verwende einen normalen Link oder eine Anmeldeschaltfläche auf der Seite.",
  "error.backend.popupUnsupportedAddress":
    "Dieses Pop-up verwendet eine nicht unterstützte Adresse. Verwende eine HTTP- oder HTTPS-Anmeldeoption auf der Seite.",
  "error.backend.popupTabLimit":
    "Die Grenze für Browser-Tabs wurde erreicht. Schließe einen Tab und versuche es dann erneut auf der Seite.",
  "error.backend.popupLoadFailed":
    "Das Pop-up konnte nicht geladen werden. Versuche die Anmeldung erneut auf der ursprünglichen Seite.",
  "error.backend.browserTabNotFound": "Browser-Tab nicht gefunden.",
  "error.backend.authActive": "Die Authentifizierung ist bereits aktiv.",
  "error.backend.authHttpsRequired": "Die sichere Authentifizierung erfordert HTTPS.",
  "error.backend.authDigitsRange": "Authentifizierungscodes benötigen 4–12 Ziffern.",
  "error.backend.authExpired": "Die Authentifizierungsanfrage ist abgelaufen.",
  "error.backend.authDigitsRequired": "Gib die angeforderte Anzahl an Ziffern ein.",
  "error.backend.browserViewProtected": "Die Browseransicht ist während der Authentifizierung geschützt.",
  "error.backend.browserPreviewPageChanged":
    "Die Browserseite wurde während der Vorschau geändert. Versuche es erneut.",
  "error.backend.browserInputProtected": "Die Browsereingabe ist während der Authentifizierung geschützt.",
  "error.backend.mcpServerHttpCredentials":
    "Der Server hat mit {status} geantwortet. Prüfe den API-Schlüssel oder andere Zugangsdaten.",
  "error.backend.mcpServerHttpUrl":
    "Der Server hat mit {status} geantwortet. Prüfe die URL. Der Link ist möglicherweise falsch, abgelaufen oder gelöscht.",
} as const satisfies PartialTranslation<typeof source>;
