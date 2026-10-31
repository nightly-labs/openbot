import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/provider";

export const messages = {
  "error.provider.mcpConfig":
    "OpenBot kon geen MCP-servers registreren in de configuratie van Codex. Controleer of je Codex-config.toml geldig en beschrijfbaar is en start OpenBot opnieuw.",
  "error.provider.computerUseConfig":
    "OpenBot kon Computerbesturing niet registreren in de configuratie van Codex. Controleer of je Codex-config.toml geldig en beschrijfbaar is en start OpenBot opnieuw. Je kunt Computerbesturing uitzetten in de instellingen van de teamgenoot om zonder door te gaan.",
  "error.provider.codexUnresponsive": "Codex reageerde niet meer, dus OpenBot heeft het proces beëindigd.",
  "error.provider.acpUnresponsive": "{provider} reageerde niet op tijd, dus OpenBot heeft het proces beëindigd.",
  "error.provider.acpMcpNotLoaded":
    "{provider} heeft de tools van OpenBot niet geladen, dus deze agent kan ze niet gebruiken en zijn teamgenoten niet bereiken. Een teambeleid van {provider} kan lokale MCP-servers blokkeren. Vraag je teambeheerder om ze toe te staan en probeer het opnieuw.",
  "error.provider.endpointsReadOnly":
    "De opgeslagen endpoints zijn geschreven door een nieuwere versie van OpenBot, of het bestand kan niet worden gelezen. Werk OpenBot bij om ze te wijzigen.",
  "error.provider.endpointNoSecureStorage":
    "Deze computer heeft geen beveiligde opslag, dus een API-sleutel of header kan niet worden opgeslagen. Verwijder ze, of gebruik een endpoint dat geen inloggegevens nodig heeft.",
  "error.provider.endpointDuplicate":
    "Er is al een endpoint met deze aanbieder-ID opgeslagen. Verwijder het eerst, of gebruik een andere ID.",
  "error.provider.endpointNotSaved": "Dit endpoint is niet opgeslagen. Vernieuw de lijst en probeer het opnieuw.",
  "error.provider.endpointKeyForNewAddress":
    "Het adres heeft een nieuwe host of poort. Voer de API-sleutel en de headers opnieuw in, zodat de opgeslagen gegevens er niet naartoe gaan.",
  "error.provider.endpointSecretUnreadable":
    "Deze computer kan de opgeslagen API-sleutel en headers niet lezen. Voer de API-sleutel en de headers opnieuw in, zodat er niets verloren gaat.",
  "error.provider.discoveryTimeout": "{host} reageerde niet op tijd.",
  "error.provider.discoveryUnreachable": "OpenBot kon geen verbinding maken met {host}.",
  "error.provider.discoveryRedirect":
    "{host} stuurde een doorverwijzing. Voer het uiteindelijke adres van de server in.",
  "error.provider.discoveryRefused": "{host} heeft het verzoek geweigerd. Controleer de API-sleutel en de headers.",
  "error.provider.discoveryHttp": "{host} antwoordde met HTTP {status}.",
  "error.provider.discoveryTooLarge": "De modellenlijst van {host} is te groot.",
  "error.provider.discoveryInvalid": "{host} stuurde geen OpenAI-compatibele modellenlijst.",
  "error.provider.detectionSettingsReadOnly":
    "De detectie-instellingen zijn geschreven door een nieuwere versie van OpenBot, of het bestand kan niet worden gelezen. Werk OpenBot bij om ze te wijzigen.",
  "error.provider.detectionEntryInvalid":
    "Een adres moet een http://- of https://-URL zonder wachtwoord zijn, en een map moet een absoluut pad zijn.",
  "error.provider.detectionEntriesTooMany": "Er zijn te veel adressen of mappen.",
  "error.provider.credentialFileUnreadable": "Het bestand met inloggegevens van de aanbieder is onleesbaar.",
  "error.provider.credentialFileTooLarge": "Het bestand met inloggegevens van de aanbieder is te groot.",
  "error.provider.archiveSpecialFile": "Het runtime-archief bevat een link of speciaal bestand.",
  "error.provider.archiveUnsafePath": "Het runtime-archief bevat een onveilig pad.",
  "error.provider.runtimeSpecialFile": "De runtime bevat een link of speciaal bestand.",
  "error.provider.codexArchivePath": "Het Codex-archief heeft een onverwacht pad.",
  "error.provider.codexVersionUnexpected": "Onverwachte versie van de Codex-runtime.",
  "error.provider.claudeArchivePath": "Het Claude-archief heeft een onverwacht pad.",
  "error.provider.claudePackageMismatch": "Het Claude-pakket komt niet overeen met de runtimecatalogus.",
  "error.provider.claudeChecksum": "Checksum van de Claude-runtime komt niet overeen.",
  "error.provider.claudeLicenseChecksum": "Checksum van de Claude-licentie komt niet overeen.",
  "error.provider.opencodeArchivePath": "Het OpenCode-archief heeft een onverwacht pad.",
  "error.provider.opencodePackageMismatch": "Het OpenCode-pakket komt niet overeen met de runtimecatalogus.",
  "error.provider.opencodeChecksum": "Checksum van de OpenCode-runtime komt niet overeen.",
  "error.provider.opencodeLicenseChecksum": "Checksum van de OpenCode-licentie komt niet overeen.",
  "error.provider.grokChecksum": "Checksum van de Grok-runtime komt niet overeen.",
  "error.provider.grokLicenseChecksum": "Checksum van de Grok-licentie komt niet overeen.",
  "error.provider.grokNoticesChecksum": "Checksum van de Grok-kennisgevingen komt niet overeen.",
  "error.provider.bunArchivePath": "Het Bun-archief heeft een onverwacht pad.",
  "error.provider.bunPackageMismatch": "Het Bun-pakket komt niet overeen met de runtimecatalogus.",
  "error.provider.bunChecksum": "Checksum van de Bun-runtime komt niet overeen.",
  "error.provider.bunLicenseChecksum": "Checksum van de Bun-licentie komt niet overeen.",
  "error.provider.bunxDamaged": "De runner van de Bun-pakketbeheerder ontbreekt of is beschadigd.",
  "error.provider.releaseSourcesUnreachable":
    "OpenBot kon de releasebronnen van de aanbieder niet bereiken. Controleer de verbinding en probeer het opnieuw.",
  "error.provider.runtimesUnsupported": "Runtimes van aanbieders zijn niet beschikbaar op dit platform.",
  "error.provider.closing": "OpenBot wordt gesloten.",
  "error.provider.cliOverride": "Verwijder het expliciet ingestelde CLI-pad voordat je bijwerkt in OpenBot.",
  "error.provider.runtimeUpdateIncomplete": "De update van de runtime is niet voltooid.",
  "error.provider.downloadHttp": "Download van de runtime is mislukt met HTTP {status}.",
  "error.provider.downloadNoData": "Download van de runtime gaf geen gegevens.",
  "error.provider.downloadSize": "De download van de runtime heeft een onverwachte grootte.",
  "error.provider.downloadIntegrity": "De download van de runtime heeft de integriteitscontrole niet doorstaan.",
  "error.provider.runtimeReplacing":
    "De runtime kon niet worden geïnstalleerd, omdat een andere instantie hem vervangt.",
  "error.provider.runtimeFilesInUse":
    "De runtime kon niet worden geïnstalleerd, omdat een ander programma de bestanden open heeft. Sluit het en probeer het opnieuw.",
  "error.provider.metadataHttp": "Download van de runtime-metadata is mislukt met HTTP {status}.",
  "error.provider.metadataIntegrity": "De runtime-metadata hebben de integriteitscontrole niet doorstaan.",
  "error.provider.diskSpace": "Er is niet genoeg vrije schijfruimte voor deze aanbieder.",
  "error.provider.unexpectedVersion": "De runtime van de aanbieder gaf een onverwachte versie.",
  "error.provider.metadataNoData": "Download van de runtime-metadata gaf geen gegevens.",
  "error.provider.metadataTooLarge": "De runtime-metadata zijn te groot.",
  "error.provider.requestFailed": "OpenBot kon {url} niet downloaden. {reason}",
  "error.provider.installRecordMismatch": "Het installatierecord van de runtime komt niet overeen.",
  "error.provider.runtimeChecksum": "Checksum van de runtime van de aanbieder komt niet overeen.",
  "error.provider.codexReleaseShape": "De Codex-release heeft een onverwachte vorm.",
  "error.provider.codexReleaseNoDownload": "De Codex-release heeft geen controleerbare download voor deze computer.",
  "error.provider.claudeReleaseShape": "De Claude-release heeft een onverwachte vorm.",
  "error.provider.grokReleaseVersion": "De Grok-release heeft een onverwachte versie.",
  "error.provider.blockedListShape": "De lijst met geblokkeerde versies heeft een onverwachte vorm.",
  "error.provider.releaseNoDownload": "De release van {name} heeft geen controleerbare download.",
  "error.provider.releaseSizeUnknown": "De grootte van de releasedownload is onbekend.",
  "error.provider.releaseMetadataNotObject": "De metadata van de release zijn geen JSON-object.",
  "error.provider.releaseCheckHttp": "De controle op releases is mislukt met HTTP {status}.",
  "error.provider.releaseMetadataTooLarge": "De metadata van de release zijn te groot.",
  "error.provider.idInvalid": "Een aanbieder-ID mag alleen kleine letters, cijfers, `-` of `_` bevatten.",
  "error.provider.baseUrlInvalid": "De basis-URL is geen URL.",
  "error.provider.baseUrlProtocol": "De basis-URL moet beginnen met http:// of https://.",
  "error.provider.baseUrlCredentials":
    "De basis-URL mag geen gebruikersnaam of wachtwoord bevatten. Zet de inloggegevens in een header.",
  "error.provider.modelsRequired": "Minstens één model is verplicht.",
  "error.provider.modelsTooMany": "Er zijn te veel modellen.",
  "error.provider.modelIdCharacter": "Een model-ID bevat een onbruikbaar teken.",
  "error.provider.modelIdDuplicate": "Twee modellen hebben dezelfde ID.",
  "error.provider.contextWindowInvalid":
    "Het contextvenster van een model moet een geheel aantal tokens zijn van {min} tot {max}.",
  "error.provider.headersTooMany": "Er zijn te veel headers.",
  "error.provider.headerNameCharacter": "Een headernaam bevat een teken dat HTTP niet toestaat.",
  "error.provider.headerNameTooLong": "Een headernaam is te lang.",
  "error.provider.headerNameDuplicate": "Twee headers hebben dezelfde naam.",
  "error.provider.headerValueInvalid": "Een headerwaarde ontbreekt of is te lang.",
  "error.provider.headerValueMissing": "De header {name} heeft een waarde nodig.",
  "error.provider.apiKeyTooLong": "De API-sleutel is te lang.",
  "error.provider.localOnly": "Aanbieders kun je alleen wijzigen op de computer waarop de agents draaien.",
  "error.provider.keyRequired": "Een sleutel van de aanbieder is verplicht.",
  "error.provider.keyTooLong": "De sleutel van de aanbieder is te lang.",
  "error.provider.keyInvalidCharacters":
    "De sleutel van de aanbieder bevat een spatie of een teken dat een sleutel niet kan bevatten.",
  "error.provider.noModel": "De gekozen aanbieder heeft geen beschikbaar model.",
  "error.provider.noModelNamed": "{provider} heeft geen model beschikbaar.",
  "error.provider.acpNoModels": "ACP CLI heeft geen ACP-modellen aangeboden. OpenBot raadt geen reservemodel.",
  "error.provider.endpointRemoveBusy":
    "Wacht tot de actieve beurt en de wachtrij klaar zijn voordat je dit endpoint verwijdert.",
  "error.provider.codexOutdated": "Codex CLI {version} is te oud. OpenBot vereist 0.156.0 of nieuwer.",
  "error.provider.codexNotStarted": "Codex CLI is gevonden, maar kon niet worden gestart.",
  "error.provider.codexNotStartedHint":
    "Codex CLI is gevonden, maar kon niet worden gestart. Voer `codex --version` uit in een nieuwe terminal.",
  "error.provider.codexManagedNotStarted":
    "ChatGPT is gedownload, maar kon niet worden gestart. Download het opnieuw in OpenBot.",
  "error.provider.codexMissing": "ChatGPT is niet gedownload. Download het in OpenBot om door te gaan.",
  "error.provider.codexConfigIgnored": {
    one: "Codex heeft {count} instelling in de configuratie genegeerd: {settings}. Corrigeer of verwijder deze, of werk Codex bij.",
    other:
      "Codex heeft {count} instellingen in de configuratie genegeerd: {settings}. Corrigeer of verwijder ze, of werk Codex bij.",
  },
  "error.provider.codexConfigIgnoredUnnamed": {
    one: "Codex heeft {count} instelling in de configuratie genegeerd. Corrigeer of verwijder deze, of werk Codex bij.",
    other:
      "Codex heeft {count} instellingen in de configuratie genegeerd. Corrigeer of verwijder ze, of werk Codex bij.",
  },
  "error.provider.claudeOutdated": "Claude Code {version} is te oud. OpenBot vereist 2.1.232 of nieuwer.",
  "error.provider.claudeNotStarted": "Claude CLI is gevonden, maar kon niet worden gestart.",
  "error.provider.claudeNotStartedHint":
    "Claude CLI is gevonden, maar kon niet worden gestart. Voer `claude --version` uit in een nieuwe terminal.",
  "error.provider.claudeManagedNotStarted":
    "Claude is gedownload, maar kon niet worden gestart. Download het opnieuw in OpenBot.",
  "error.provider.claudeMissing": "Claude is niet gedownload. Download het in OpenBot om door te gaan.",
  "error.provider.grokOutdated": "Grok CLI {version} is te oud. OpenBot vereist 1.0.5 of nieuwer.",
  "error.provider.grokNotStarted": "Grok CLI is gevonden, maar kon niet worden gestart.",
  "error.provider.grokNotStartedHint":
    "Grok CLI is gevonden, maar kon niet worden gestart. Voer `grok --version` uit in een nieuwe terminal.",
  "error.provider.grokMissing": "Grok is niet gedownload. Download het in OpenBot om door te gaan.",
  "error.provider.opencodeNotStarted": "OpenCode kon niet starten. Voer `opencode --version` uit in een terminal.",
  "error.provider.opencodeMissing": "OpenCode is niet gedownload. Download het in OpenBot om door te gaan.",
  "error.provider.codexVersionUnreadable": "Kan de versie van Codex CLI niet lezen.",
  "error.provider.claudeVersionUnreadable": "Kan de versie van Claude CLI niet lezen.",
  "error.provider.grokVersionUnreadable": "Kan de versie van Grok CLI niet lezen.",
  "error.provider.opencodeVersionUnreadable": "Kan de versie van OpenCode CLI niet lezen.",
  "error.provider.bunVersionUnreadable": "Kan de versie van de Bun-runtime niet lezen.",
  "error.provider.connectBeforeProfile": "Verbind de gekozen aanbieder voordat je een profiel maakt.",
  "error.provider.cliNotReady": "{provider} CLI is niet klaar of niet ingelogd.",
  "error.provider.cliTimedOut":
    "{provider} reageerde niet op tijd. De computer is misschien bezet. OpenBot probeert het opnieuw.",
  "error.provider.cliTimedOutRefresh":
    "{provider} reageerde niet op tijd. De computer is misschien bezet. Vernieuw de aanbieders om het opnieuw te proberen.",
  "error.provider.acpStartTimedOut":
    "{provider} was niet binnen {seconds} s klaar met starten. De computer is misschien bezet.",
  "error.provider.acpModelsTimedOut":
    "{provider} gaf de modellen niet binnen {seconds} s. De computer is misschien bezet.",
  "error.provider.startStopped":
    "{provider} is meerdere keren achter elkaar niet gestart, dus OpenBot probeert het niet meer. Vernieuw de aanbieders om het opnieuw te proberen.",
  "error.provider.tempDiskSpace":
    "{provider} heeft minstens 1 GB vrije schijfruimte nodig om te starten. Maak ruimte vrij en vernieuw daarna de aanbieders.",
  "error.provider.noCodeSignIn": "Bij {provider} kun je niet inloggen met een code.",
  "error.provider.codeLoginNoLink": "De aanbieder toonde geen inloglink. Probeer het opnieuw.",
  "error.provider.hostSignInEnded": "{provider} heeft het inloggen niet afgerond. Probeer het opnieuw.",
  "error.provider.codeLoginNotWaiting": "Er wacht geen inlog op een code. Start het inloggen opnieuw.",
  "error.provider.codeLoginBadCode": "Plak de code die de inlogpagina toont.",
  "error.provider.codeLoginRefused": "De aanbieder heeft de code niet geaccepteerd. Start het inloggen opnieuw.",
  "error.provider.codeLoginUnsupported":
    "Deze server kan niet inloggen met een geplakte code. Log in op de servercomputer, in de browser daar.",
  "error.provider.cliBusyRetry":
    "De {provider} CLI werkt aan een beurt. Wacht tot die klaar is en probeer het opnieuw.",
  "error.provider.cliSigningIn":
    "De {provider} CLI is bezig met inloggen. Rond het inloggen af of annuleer het, en werk dan bij.",
  "error.provider.cliBusyUpdate": "De {provider} CLI werkt aan een beurt. Wacht tot die klaar is en werk dan bij.",
  "error.provider.cliSelectFailed": "OpenBot kon de geïnstalleerde beheerde CLI niet selecteren.",
  "error.provider.noAuthenticatedAccount": "{provider} gaf geen geverifieerd account terug.",
  "error.provider.signInExpired": "Je inlog bij {provider} is verlopen. Log opnieuw in om door te gaan.",
  "error.provider.cliActivateFailed": "OpenBot kon de beheerde CLI niet activeren.",
  "error.provider.cliBusyReconnect":
    "De {provider} CLI werkt aan een beurt. Wacht tot die klaar is en verbind dan opnieuw.",
  "error.provider.cliBusySignOut":
    "De {provider}-CLI verwerkt een beurt. Wacht tot die klaar is en verbreek dan de verbinding.",
  "error.provider.opencodeCredentialsRejected":
    "De modelaanbieder heeft de API-sleutel geweigerd. Corrigeer de OpenCode-sleutel in Instellingen, of de sleutel van de aanbieder met `opencode auth login`. Probeer het daarna opnieuw of kies een ander model.\n{detail}",
  "error.provider.opencodeAuthRequired":
    "OpenCode heeft geen inlog voor de modelaanbieder “{provider}”. Kies een model met het label Gratis, of verbind de aanbieder: plak een OpenCode Go-sleutel in de OpenCode-instellingen, of voer `opencode auth login` uit in een terminal. Probeer het daarna opnieuw.",
  "error.provider.opencodeAuthRequiredUnknown":
    "OpenCode heeft geen inlog voor de aanbieder van dit model. Kies een model met het label Gratis, of verbind de aanbieder: plak een OpenCode Go-sleutel in de OpenCode-instellingen, of voer `opencode auth login` uit in een terminal. Probeer het daarna opnieuw.",
  "error.provider.opencodeKeyExpired":
    "Je OpenCode-API-sleutel is verlopen. Maak een nieuwe sleutel in OpenCode Console, plak hem in de OpenCode-instellingen en probeer het opnieuw.",
  "error.provider.opencodeServiceFailure":
    "OpenCode kon deze beurt niet voltooien, omdat de lokale service is mislukt. Probeer het opnieuw. Blijft de fout, verbind OpenCode dan opnieuw in Instellingen.",
  "error.provider.opencodeRateLimited":
    "De modelaanbieder heeft het verzoek geweigerd vanwege de limiet op het aantal verzoeken. Wacht een paar minuten of kies een ander model, en probeer het opnieuw.\n{detail}",
  "error.provider.opencodeBilling":
    "De modelaanbieder heeft het verzoek geweigerd vanwege de facturering van het account. Wachten lost dit niet op. Voeg een betaalmethode of tegoed toe in het account van de aanbieder, of kies een ander model.\n{detail}",
  "error.provider.opencodeInvalidUpload":
    "De modelaanbieder van OpenCode meldde een ongeldig uploadverzoek. Kies een ander model en ga verder. Controleer opgeslagen routines voordat je ze opnieuw maakt.\n{detail}",
  "error.provider.opencodeUnreadableContent":
    "Dit model kan een bestand of afbeelding in deze chat niet lezen. Kies een model dat bestanden kan lezen en stuur je bericht opnieuw.",
  "error.provider.opencodeFreeLimit":
    "De gratis OpenCode-modellen hebben hun gebruikslimiet bereikt. Alle gratis modellen delen deze limiet. Plak een OpenCode Go-sleutel in de OpenCode-instellingen om door te gaan, of kies een model van een andere aanbieder.",
  "error.provider.opencodeProviderFailed":
    "De modelaanbieder had een storing aan zijn kant. Het ligt niet aan je verbinding. Probeer het later opnieuw of kies een ander model.\n{detail}",
  "error.provider.opencodeNetwork":
    "OpenCode kon geen verbinding maken met de modelaanbieder. Controleer de netwerkverbinding van de computer waarop OpenBot draait en probeer het opnieuw.\n{detail}",
  "error.provider.opencodeDatabaseNewer":
    "OpenCode kon de database niet openen, omdat een nieuwere versie van OpenCode deze heeft gewijzigd. Werk OpenCode bij naar versie 2 of nieuwer en probeer het opnieuw.",
  "error.provider.opencodeNoAnswer":
    "Het OpenCode-model beëindigde de beurt zonder antwoord. Probeer het opnieuw, of kies een ander model.",
  "error.provider.opencodeReasoningWithoutAnswer":
    "Het OpenCode-model beëindigde de beurt na het redeneren, zonder antwoord. Probeer het opnieuw, of kies een ander model.",
  "error.provider.chatgptPageFailed": "OpenBot kon de verbindingspagina van ChatGPT niet openen.",
  "error.provider.noneReady": "Er is geen agentaanbieder klaar.",
  "error.provider.claudeTurnActive": "Wacht op de actieve Claude-beurt voordat je de context vernieuwt.",
  "error.provider.codexLoginRequired": "Codex vereist inloggen met een ChatGPT-abonnement. Voer `codex login` uit.",
  "error.provider.cliUpdateFailed": "OpenBot kon de {provider} CLI niet bijwerken. {reason}",
  "error.provider.tryAgain": "Probeer het opnieuw.",
  "error.provider.noAgentProcess": "{provider} heeft geen proces dat draait voor deze agent.",
  "error.provider.stoppedBeforeAgentProcess": "{provider} is gestopt voordat het proces van de agent startte.",
  "error.provider.archiveUnreadable":
    "Het runtime-archief kan niet worden gelezen of gebruikt een niet-ondersteunde indeling.",
  "error.provider.antigravityArchivePath": "Het Gemini-archief bevat een onverwacht bestand.",
  "error.provider.antigravityChecksum": "Checksum van de Gemini-runtime komt niet overeen.",
  "error.provider.antigravityReleaseShape": "De Gemini-release heeft een onverwachte vorm.",
  "error.provider.antigravityMissing": "Gemini is niet gedownload. Download het in OpenBot om door te gaan.",
  "error.provider.antigravityNotStarted": "De Gemini-server is gevonden, maar de versie kan niet worden gelezen.",
  "error.provider.antigravityVersionUnreadable": "Kan de versie van de Gemini-server niet lezen.",
  "error.provider.antigravitySignIn": "Log in met Google om Gemini te gebruiken.",
  "error.provider.antigravityRateLimited":
    "Gemini heeft het verzoek geweigerd, omdat een limiet op het aantal verzoeken of het quotum van het abonnement is bereikt. Wacht een paar minuten of kies een ander model, en probeer het opnieuw.\n{detail}",
  "error.provider.antigravityQuotaReached":
    "Google meldt dat een gebruikslimiet van Gemini is bereikt. De limiet kan voor één model gelden, dus de gebruikspagina van je abonnement kan meer resterend tonen. Kies een ander Gemini-model, of wacht tot de limiet wordt gereset.\n{detail}",
  "error.provider.antigravityModelUnavailable":
    "Gemini kan dit model nu niet gebruiken. Kies een ander model en probeer het opnieuw.\n{detail}",
  "error.provider.antigravityServiceFailure":
    "De Gemini-service van Google heeft het verzoek niet voltooid. Probeer het over een paar minuten opnieuw.\n{detail}",
  "error.provider.cursorArchivePath": "Het Cursor-archief bevat een onverwacht bestand.",
  "error.provider.cursorChecksum": "Checksum van de Cursor-runtime komt niet overeen.",
  "error.provider.cursorReleaseShape": "De Cursor-release heeft een onverwachte vorm.",
  "error.provider.cursorMissing": "Cursor is niet gedownload. Download het in OpenBot om door te gaan.",
  "error.provider.cursorNotStarted": "De Cursor-agent is gevonden, maar de versie kan niet worden gelezen.",
  "error.provider.cursorVersionUnreadable": "Kan de versie van de Cursor-agent niet lezen.",
  "error.provider.cursorSignIn": "Log in met Cursor of stel CURSOR_API_KEY in om Cursor te gebruiken.",
  "error.provider.clineArchivePath": "Het Cline-archief heeft een onverwacht pad.",
  "error.provider.clinePackageMismatch": "Het Cline-pakket komt niet overeen met de runtimecatalogus.",
  "error.provider.clineChecksum": "Checksum van de Cline-runtime komt niet overeen.",
  "error.provider.clineLicenseChecksum": "Checksum van de Cline-licentie komt niet overeen.",
  "error.provider.clineMissing": "Cline is niet gedownload. Download het in OpenBot om door te gaan.",
  "error.provider.clineOutdated": "Cline CLI {version} is te oud. OpenBot vereist 3.0.68 of nieuwer.",
  "error.provider.clineNotStarted": "Cline kon niet starten. Voer `cline --version` uit in een terminal.",
  "error.provider.clineVersionUnreadable": "Kan de versie van Cline CLI niet lezen.",
  "error.provider.clineSignIn": "Log in met Cline of stel CLINE_API_KEY in om Cline te gebruiken.",
  "error.provider.usageLimitReached": "Het account heeft de gebruikslimiet bereikt.",
  "error.provider.foreignReasoning":
    "{provider} heeft het eerdere redeneren in deze chat niet geaccepteerd, omdat een ander account of een andere API-sleutel het heeft ontvangen. OpenBot heeft een nieuwe {provider}-sessie gestart met de chatgeschiedenis. Probeer het opnieuw.",
  "error.provider.opencodeSessionRejected":
    "OpenCode heeft het verzoek geweigerd zonder de oorzaak te geven. Dit kan gebeuren in een lange chat of na een modelwijziging. OpenBot heeft een nieuwe OpenCode-sessie gestart met de chatgeschiedenis. Probeer het opnieuw. Blijft de fout, kies dan een ander model of een lager niveau.",
  "error.provider.museMcpStartupFault":
    "Muse kon een MCP-server niet starten en heeft MCP in deze sessie geblokkeerd. OpenBot heeft een nieuwe Muse-sessie gestart met de chatgeschiedenis. Probeer het opnieuw. Blijft de fout, zet dan Computerbesturing of de mislukte MCP-server uit voor deze agent.",
  "error.provider.grokSignIn": "Voer `grok login` uit of stel XAI_API_KEY in om Grok te gebruiken.",
  "error.provider.acpSignInTimedOut": "Het inloggen duurde te lang.",
  "error.provider.acpSignInStopped": "Het inloggen is gestopt voordat het klaar was.",
  "error.provider.geminiBrowserUnavailable":
    "Gemini kon de inlogpagina niet openen. Installeer een browser en xdg-utils en verbind vanuit een desktopsessie op deze host. Een server zonder desktop kan deze inlog niet afronden.",
  "error.provider.geminiBrowserOpenFailed":
    "Gemini kon de inlogpagina niet in je browser openen. Controleer je standaardbrowser en verbind daarna opnieuw.",
  "error.provider.acpSignInFailed": "Het inloggen is niet voltooid.",
  "error.provider.acpSignInFailedReason": "Het inloggen is niet voltooid: {reason}",
  "error.provider.acpSignInMethodMissing":
    "Deze aanbieder biedt deze inlog niet aan op deze computer. Werk de aanbieder bij en probeer het opnieuw.",
  "error.provider.httpsSignInLinkOnly": "Alleen HTTPS-inloglinks kunnen in de browser worden geopend.",
  "error.provider.geminiKeyRefused":
    "Gemini heeft de opgeslagen API-sleutel geweigerd. Vervang of verwijder de sleutel in Instellingen en verbind opnieuw.",
  "error.provider.keyProviderRefused":
    "{provider} heeft de opgeslagen API-sleutel geweigerd. Vervang of verwijder de sleutel in Instellingen en probeer het opnieuw.",
  "error.provider.keyProviderNoBalance":
    "Het {provider}-account van de opgeslagen API-sleutel heeft geen saldo. Voeg tegoed toe aan het account en probeer het opnieuw.",
  "error.provider.messageTooLarge":
    "OpenBot heeft {provider} gestopt, omdat het een bericht groter dan {limit} MB stuurde.",
  "error.provider.customAgentIdInvalid":
    "Een agent-ID mag alleen kleine letters, cijfers of `-` bevatten, en mag niet de ID van een ingebouwde aanbieder zijn.",
  "error.provider.customAgentEnvInvalid":
    "Een variabelenaam mag alleen letters, cijfers of `_` bevatten en mag niet met een cijfer beginnen. Gebruik elke naam één keer, maximaal 16 namen.",
  "error.provider.customAgentUsagePromptInvalid": "Een gebruiksopdracht moet één regel van maximaal 256 tekens zijn.",
  "error.provider.customAgentCommandInvalid":
    "De opdracht moet een volledig pad zijn, een pad dat begint met ~/, of een opdrachtnaam zonder spaties.",
  "error.provider.customAgentArgsInvalid": "Een argument mag geen regeleinde bevatten. Gebruik maximaal 32 argumenten.",
  "error.provider.customAgentWindowsScript":
    "Een .cmd- of .bat-opdracht accepteert alleen letters, cijfers en - _ . , : = @ + / \\ in de argumenten.",
  "error.provider.customAgentNotFound": "OpenBot kan {command} niet vinden. Voer het volledige pad van de opdracht in.",
  "error.provider.customAgentCheckTimedOut": "De agent reageerde niet binnen 20 seconden.",
  "error.provider.customAgentCheckStopped": "De agent is gestopt voordat hij antwoordde.",
  "error.provider.customAgentProtocolVersion": "De agent gebruikt ACP-versie {version}. OpenBot gebruikt versie 1.",
  "error.provider.customAgentCheckFailed": "De agent antwoordde niet als een ACP-agent.",
  "error.provider.customAgentRemoveBusy":
    "Wacht tot de actieve beurt en de wachtrij klaar zijn voordat je deze aangepaste agent verwijdert.",
  "error.provider.customAgentNone": "Er is geen aangepaste agent opgeslagen.",
  "error.provider.customAgentMissing": "Deze aangepaste agent is nu niet opgeslagen. Kies een ander model.",
  "error.provider.customAgentSignIn": "Log in met de eigen opdracht van de agent en probeer het opnieuw.",
  "error.provider.customAgentsReadOnly":
    "De opgeslagen aangepaste agents zijn geschreven door een nieuwere versie van OpenBot, of het bestand kan niet worden gelezen. Werk OpenBot bij om ze te wijzigen.",
  "error.provider.customAgentNoSecureStorage":
    "Deze computer heeft geen beveiligde opslag, dus omgevingswaarden kunnen niet worden opgeslagen. Verwijder ze en probeer het opnieuw.",
  "error.provider.customAgentNotSaved":
    "Deze aangepaste agent is niet opgeslagen. Vernieuw de lijst en probeer het opnieuw.",
  "error.provider.customAgentTooMany": "Je kunt maximaal {count} aangepaste agents opslaan.",
  "error.provider.customAgentEnvValueMissing": "Voer een waarde in voor {name}.",
  "error.provider.off": "{provider} staat uit in OpenBot. Zet het eerst aan in de instellingen voor aanbieders.",
  "error.provider.inUse":
    "Een agent gebruikt {provider}. Wijzig het model van de agent voordat je deze aanbieder uitzet.",
  "error.provider.useBusy": "Wacht tot de controle van de aanbieder of het inloggen klaar is en probeer het opnieuw.",
  "error.provider.useSettingsReadOnly":
    "De opgeslagen instellingen voor aanbieders kunnen niet worden gelezen. Werk OpenBot bij voordat je ze wijzigt.",
  "error.provider.useChangeFailed": "OpenBot kon de instelling van de aanbieder niet wijzigen.",
  "error.provider.accountsUnsupported": "{provider} kan maar één account hebben.",
  "error.provider.accountNeedsConnection": "Verbind {provider} voordat je nog een account toevoegt.",
  "error.provider.usageResetUnsupported": "{provider} kan gebruikslimieten niet resetten.",
  "error.provider.signOutUnsupported": "OpenBot kan de {provider}-aanmelding niet verbreken.",
  "error.provider.usageResetNotConnected": "Log opnieuw in bij dit {provider}-account voordat je het gebruik reset.",
  "error.provider.accountLimit": "{provider} kan maximaal {limit} accounts hebben.",
  "error.provider.accountNotFound":
    "Dit {provider}-account staat niet op deze computer. Vernieuw en probeer het opnieuw.",
  "error.provider.accountAlreadyAdded": "Dit {provider}-account is al verbonden.",
  "error.provider.accountDefault": "Het eerste {provider}-account kan niet worden verwijderd.",
  "error.provider.accountUsesKey":
    "Dit {provider}-account gebruikt de opgeslagen API-sleutel en heeft geen inlog. Wijzig de sleutel in Serverinstellingen → Aanbieders.",
  "error.provider.accountInUse": "Een agent op dit account is aan het werk. Probeer het opnieuw als de agent stopt.",
  "error.provider.accountsReadOnly":
    "De opgeslagen accounts van aanbieders kunnen niet worden gelezen. Werk OpenBot bij voordat je ze wijzigt.",
  "error.provider.accountSignedOut": "Dit {provider}-account is uitgelogd. Log opnieuw in.",
  "error.provider.sessionSettingUnavailable":
    "Deze instelling is niet beschikbaar in de huidige sessie van de aanbieder.",
  "error.provider.sessionSettingInvalid": "Deze waarde is niet beschikbaar voor de instelling.",
  "error.provider.sessionSettingsBusy": "Wacht tot de huidige beurt klaar is voordat je een sessie-instelling wijzigt.",
  "error.provider.piOutdated":
    "Pi {version} is te oud. Installeer Pi 1.1.0 of nieuwer voor native ondersteuning van RPC en MCP.",
  "error.provider.nativeMissing": "De {provider} CLI is niet geïnstalleerd. Download hem in Instellingen.",
  "error.provider.nativeNotStarted": "De {provider} CLI kon niet starten.",
  "error.provider.nativeVersionUnreadable": "De versie van de {provider} CLI kon niet worden gelezen.",
  "error.provider.piSessionBusy": "Wacht tot de huidige Pi-beurt klaar is.",
  "error.provider.piStopped": "Pi draait niet. Verbind Pi en probeer het opnieuw.",
  "error.provider.piSessionMissing": "Het Pi-sessiebestand is niet beschikbaar op deze computer.",
  "error.provider.piResumeCancelled": "Pi heeft het hervatten van de sessie geannuleerd. Probeer het opnieuw.",
  "error.provider.piSessionIdentity": "Pi gaf een andere sessie terug. De opgeslagen sessie is niet vervangen.",
  "error.provider.piModelInvalid": "Kies een Pi-model dat de aanbieder bevat.",
  "error.provider.piToolInvalid": "De tool gaf een ongeldig resultaat terug.",
  "error.provider.piSignIn": "Gebruik /login in Pi op de hostcomputer. Sluit Pi als het inloggen klaar is.",
  "error.provider.museBusy": "De Muse-sessie is bezet.",
  "error.provider.museStopped": "De Muse-client draait niet.",
  "error.provider.museUnexpectedProvider": "Muse gaf een onverwachte modelaanbieder terug.",
  "error.provider.museNoActiveTurn": "Muse heeft geen actieve beurt om bij te sturen.",
  "error.provider.museInvalidProtocol": "Muse gaf een ongeldig protocolantwoord terug.",
  "error.provider.museNotStarted": "Muse is niet gestart.",
  "error.provider.museNativeWindows": "Muse vereist een native uitvoerbaar bestand op Windows.",
  "error.provider.museStartTimeout": "Het initialiseren van Muse duurde te lang.",
  "error.provider.museStartStopped": "Muse is gestopt tijdens het initialiseren.",
  "error.provider.museProtocolVersion": "Niet-ondersteunde protocolversie van Muse.",
  "error.provider.museHistoryRequired": "Muse moet de sessiegeschiedenis bewaren.",
  "error.provider.museRequestUnsupported": "Niet-ondersteund serververzoek van Muse.",
  "error.provider.museConnectionFailed":
    "Verbinding met Muse is mislukt. Hervat het gesprek om de opgeslagen geschiedenis te herstellen.",
  "error.provider.museUnknownSession": "Onbekende Muse-sessie.",
  "error.provider.museInvalidToolResult": "Ongeldig resultaat van een OpenBot-tool.",
  "error.provider.museMcpRequired": "Muse moet MCP-servers per sessie ondersteunen.",
  "error.provider.museSessionMismatch": "Muse gaf een andere sessie terug.",
  "error.provider.museCompactRejected": "Muse heeft het comprimeren niet geaccepteerd.",
  "error.provider.museTurnMismatch": "Muse gaf een andere beurt terug.",
  "error.provider.museHistoryMismatch": "De geschiedenis van Muse loopt over sessies heen.",
  "error.provider.museRecoveryFailed": "Muse kon de ontbrekende events niet herstellen.",
  "error.provider.museHistoryStalled": "De geschiedeniscursor van Muse is niet verder gegaan.",
  "error.provider.museApprovalUnavailable": "Muse bood dit goedkeuringsantwoord niet aan.",
  "error.provider.museHistoryOwner": "De geschiedenis van Muse hoort bij een andere sessie.",
  "error.provider.museHistoryMissing": "Muse gaf geen sessiegeschiedenis terug.",
  "error.provider.museEmptyInput": "Muse heeft tekst of een afbeelding nodig.",
  "error.provider.museMethodUnsupported": "Muse ondersteunt {method} niet.",
  "error.provider.museTurnFailed": "De Muse-beurt is mislukt.",
  "error.provider.museProfileUnsupported":
    "Muse kan geen profiel maken zonder toegang tot externe tools. Gebruik een andere aanbieder om het profiel te maken en kies daarna Muse voor de agent.",
  "error.provider.museAuthUnverified":
    "De verificatie van Muse is niet bevestigd. Verbind op de hostcomputer, of stel een Meta-API-sleutel in.",
  "error.provider.museSignIn": "Log in bij Muse op de hostcomputer om door te gaan.",
  "error.provider.inceptionSignIn": "Voeg een Inception-API-sleutel toe om door te gaan.",
  "error.provider.deepseekSignIn": "Voeg een DeepSeek-API-sleutel toe om door te gaan.",
  "error.provider.openrouterSignIn": "Voeg een OpenRouter-API-sleutel toe om door te gaan.",
  "error.provider.terminalLoginFailed":
    "De inlogterminal kon niet openen. Open de CLI van de aanbieder op deze host, log daar in en vernieuw daarna de aanbieders.",
  "error.provider.nativeArchiveInvalid": "De download van de aanbieder bevat geen geldige installatie.",
  "error.provider.nativeChecksum": "De installatie van de aanbieder heeft de integriteitscontrole niet doorstaan.",
  "error.provider.registryUnavailable": "Het ACP-register is niet beschikbaar. Probeer het opnieuw.",
  "error.provider.registryInvalid": "Het ACP-register gaf ongeldige gegevens terug.",
  "error.provider.registryMissing": "Deze agent staat niet in het ACP-register.",
  "error.provider.registryBusy": "Er loopt al een installatie voor deze agent.",
  "error.provider.registryCancelled": "De installatie van de agent is geannuleerd.",
  "error.provider.registryPrerequisite": "Installeer {tool} op de host voordat je deze agent installeert.",
  "error.provider.registryBindingChanged":
    "De aangepaste agent is gewijzigd tijdens de installatie. Probeer het opnieuw.",
  "error.provider.registryInstallFailed":
    "De installatie van de agent is mislukt. De vorige installatie is ongewijzigd.",
  "error.provider.registryRemoveBusy":
    "Wacht tot de installatie van de agent en het actieve ACP-werk klaar zijn voordat je de agent verwijdert.",
} as const satisfies PartialTranslation<typeof source>;
