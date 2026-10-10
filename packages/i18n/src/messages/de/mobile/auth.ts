import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "OpenBot-Logo animieren",
  "mobile.auth.logo.animateHint": "Lässt das Logo zwinkern",
  "mobile.auth.scanQrCode": "QR-Code scannen",
  "mobile.auth.closeScanner": "Scanner schließen",
  "mobile.auth.scanner.connectFailed": "Verbindung fehlgeschlagen",
  "mobile.auth.scanner.codeFailed": "Dieser Code kann nicht verwendet werden",
  "mobile.auth.scanner.scanAgain": "Erneut scannen",
  "mobile.auth.scanner.connecting": "Dein Telefon wird verbunden…",
  "mobile.auth.scanner.readingInvitation": "Einladung wird gelesen…",
  "mobile.auth.scanner.scanDesktop": "Scanne den Code vom Desktop",
  "mobile.auth.scanner.scanInvitation": "Scanne den Einladungscode",
  "mobile.auth.scanner.verifying": "Der Einmalcode wird überprüft.",
  "mobile.auth.scanner.checkingServer": "Die Identität des Servers wird geprüft.",
  "mobile.auth.scanner.keepCentered": "Halte den QR-Code mittig im Rahmen.",
  "mobile.auth.scanner.connectFallback": "OpenBot konnte dieses Telefon nicht verbinden.",
  "mobile.auth.scanner.cameraFailed": "Die Kamera konnte nicht gestartet werden. Versuche es erneut.",
  "mobile.auth.camera.title": "Kamerazugriff erforderlich",
  "mobile.auth.camera.pairingReason":
    "OpenBot verwendet die Kamera nur, um den einmaligen QR-Code aus der Desktop-App zu scannen.",
  "mobile.auth.camera.invitationReason": "OpenBot verwendet die Kamera nur, um den QR-Code der Einladung zu scannen.",
  "mobile.auth.camera.blocked":
    "Der Kamerazugriff ist blockiert. Aktiviere ihn für OpenBot in den Geräteeinstellungen und kehre dann hierher zurück, um den Code zu scannen.",
  "mobile.auth.camera.allow": "Kamerazugriff erlauben",
  "mobile.auth.camera.openSettings": "Einstellungen öffnen",
  "mobile.auth.signIn.title": "Deine Agenten, überall.",
  "mobile.auth.signIn.subtitle": "Verbinde dich mit OpenBot auf deinem Computer.",
  "mobile.auth.signIn.helpTitle": "Wo ist der QR-Code?",
  "mobile.auth.signIn.helpStep1": "1. Öffne OpenBot auf deinem Computer.",
  "mobile.auth.signIn.helpStep2": "2. Gehe zu Einstellungen → Mobilverbindung.",
  "mobile.auth.signIn.helpStep3": "3. Wähle „QR-Code erstellen“ und scanne ihn dann hier.",
  "mobile.auth.error.sessionEnded":
    "Deine Sitzung ist beendet. Scanne einen neuen Code aus OpenBot auf deinem Desktop.",
  "mobile.auth.error.connectionInProgress":
    "Eine andere Verbindung wird gerade hergestellt. Warte, bis sie abgeschlossen ist.",
  "mobile.auth.error.invalidCode": "Dies ist kein gültiger Code für die OpenBot-Mobilverbindung.",
  "mobile.auth.error.codeOutdated":
    "Erstelle in einer aktualisierten Desktop-App einen neuen Code für die Mobilverbindung.",
  "mobile.auth.error.alreadySignedIn":
    "Du bist bereits angemeldet. Melde dich ab, bevor du ein anderes Konto verbindest.",
  "mobile.auth.error.desktopUnreachable":
    "OpenBot konnte deinen Desktop nicht erreichen. Halte beide Geräte im selben WLAN und erlaube den Zugriff auf das lokale Netzwerk.",
  "mobile.auth.error.accountServiceUnreachable":
    "OpenBot konnte den Kontodienst nicht erreichen. Prüfe deine Verbindung und versuche es erneut.",
  "mobile.auth.error.codeExpired": "Dieser Code für die Mobilverbindung ist ungültig oder abgelaufen.",
  "mobile.auth.error.revokePreviousFailed":
    "Die vorherige mobile Sitzung konnte nicht widerrufen werden. Prüfe deine Verbindung und scanne erneut.",
  "mobile.auth.error.verifyFailed": "OpenBot konnte diese mobile Sitzung nicht überprüfen.",
  "mobile.auth.error.sessionsLoadFailed": "Die Kontositzungen konnten nicht geladen werden. Versuche es erneut.",
  "mobile.auth.error.useSignOut": "Verwende „Abmelden“, um dieses Gerät zu trennen.",
  "mobile.auth.error.desktopSession": "Desktop-Sitzungen können nicht vom Mobilgerät aus getrennt werden.",
  "mobile.auth.error.disconnectFailed":
    "Diese Sitzung konnte nicht getrennt werden. Aktualisiere und versuche es erneut.",
  "mobile.auth.error.nameLength": "Gib einen Anzeigenamen mit 3 bis 20 Zeichen ein.",
  "mobile.auth.error.photoTooLarge": "Wähle ein Foto, das kleiner als 512 KB ist.",
  "mobile.auth.error.photoInvalid": "Das ausgewählte Foto ist ungültig. Wähle ein anderes Bild.",
  "mobile.auth.error.tooManyChanges": "Zu viele Änderungen. Warte einen Moment und versuche es erneut.",
  "mobile.auth.error.photoConflict": "Dein Foto wurde auf einem anderen Gerät geändert. Versuche es erneut.",
  "mobile.auth.error.profileSaveFailed":
    "Dein Profil konnte nicht gespeichert werden. Prüfe deine Verbindung und versuche es erneut.",
  "mobile.auth.error.signOutUnconfirmed":
    "Die Abmeldung konnte nicht bestätigt werden. Prüfe deine Verbindung und versuche es erneut.",
} as const satisfies PartialTranslation<typeof source>;
