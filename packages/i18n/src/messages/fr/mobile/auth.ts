import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "Animer le logo OpenBot",
  "mobile.auth.logo.animateHint": "Fait un clin d’œil avec le logo",
  "mobile.auth.scanQrCode": "Scanner le code QR",
  "mobile.auth.closeScanner": "Fermer le scanner",
  "mobile.auth.scanner.connectFailed": "Connexion impossible",
  "mobile.auth.scanner.codeFailed": "Impossible d’utiliser ce code",
  "mobile.auth.scanner.scanAgain": "Scanner à nouveau",
  "mobile.auth.scanner.connecting": "Connexion de votre téléphone…",
  "mobile.auth.scanner.readingInvitation": "Lecture de l’invitation…",
  "mobile.auth.scanner.scanDesktop": "Scannez le code de l’ordinateur",
  "mobile.auth.scanner.scanInvitation": "Scannez le code d’invitation",
  "mobile.auth.scanner.verifying": "Vérification du code à usage unique.",
  "mobile.auth.scanner.checkingServer": "Vérification de l’identité du serveur.",
  "mobile.auth.scanner.keepCentered": "Gardez le code QR au centre du cadre.",
  "mobile.auth.scanner.connectFallback": "OpenBot n’a pas pu connecter ce téléphone.",
  "mobile.auth.scanner.cameraFailed": "Impossible de démarrer l’appareil photo. Réessayez.",
  "mobile.auth.camera.title": "Accès à l’appareil photo requis",
  "mobile.auth.camera.pairingReason":
    "OpenBot utilise l’appareil photo uniquement pour scanner le code QR à usage unique affiché dans l’app de bureau.",
  "mobile.auth.camera.invitationReason":
    "OpenBot utilise l’appareil photo uniquement pour scanner le code QR de l’invitation.",
  "mobile.auth.camera.blocked":
    "L’accès à l’appareil photo est bloqué. Activez-le pour OpenBot dans les réglages de l’appareil, puis revenez ici pour scanner le code.",
  "mobile.auth.camera.allow": "Autoriser l’appareil photo",
  "mobile.auth.camera.openSettings": "Ouvrir les réglages",
  "mobile.auth.signIn.title": "Vos agents, partout.",
  "mobile.auth.signIn.subtitle": "Connectez-vous à OpenBot sur votre ordinateur.",
  "mobile.auth.signIn.helpTitle": "Où est le code QR ?",
  "mobile.auth.signIn.helpStep1": "1. Ouvrez OpenBot sur votre ordinateur.",
  "mobile.auth.signIn.helpStep2": "2. Allez dans Réglages → Mobile Connect.",
  "mobile.auth.signIn.helpStep3": "3. Choisissez Générer un code QR, puis scannez-le ici.",
  "mobile.auth.error.sessionEnded":
    "Votre session est terminée. Scannez un nouveau code depuis OpenBot sur votre ordinateur.",
  "mobile.auth.error.connectionInProgress": "Une autre connexion est en cours. Attendez qu’elle se termine.",
  "mobile.auth.error.invalidCode": "Ce n’est pas un code OpenBot Mobile Connect valide.",
  "mobile.auth.error.codeOutdated": "Générez un nouveau code Mobile Connect dans une app de bureau à jour.",
  "mobile.auth.error.alreadySignedIn": "Vous êtes déjà connecté. Déconnectez-vous avant de connecter un autre compte.",
  "mobile.auth.error.desktopUnreachable":
    "OpenBot n’a pas pu joindre votre ordinateur. Gardez les deux appareils sur le même réseau Wi-Fi et autorisez l’accès au réseau local.",
  "mobile.auth.error.accountServiceUnreachable":
    "OpenBot n’a pas pu joindre le service de compte. Vérifiez votre connexion et réessayez.",
  "mobile.auth.error.codeExpired": "Ce code Mobile Connect n’est pas valide ou a expiré.",
  "mobile.auth.error.revokePreviousFailed":
    "Impossible de révoquer la session mobile précédente. Vérifiez votre connexion et scannez à nouveau.",
  "mobile.auth.error.verifyFailed": "OpenBot n’a pas pu vérifier cette session mobile.",
  "mobile.auth.error.sessionsLoadFailed": "Impossible de charger les sessions du compte. Réessayez.",
  "mobile.auth.error.useSignOut": "Utilisez Se déconnecter pour déconnecter cet appareil.",
  "mobile.auth.error.desktopSession": "Les sessions de bureau ne peuvent pas être déconnectées depuis le mobile.",
  "mobile.auth.error.disconnectFailed": "Impossible de déconnecter cette session. Actualisez et réessayez.",
  "mobile.auth.error.nameLength": "Saisissez un nom d’affichage de 3 à 20 caractères.",
  "mobile.auth.error.photoTooLarge": "Choisissez une photo de moins de 512 Ko.",
  "mobile.auth.error.photoInvalid": "La photo choisie n’est pas valide. Choisissez une autre image.",
  "mobile.auth.error.tooManyChanges": "Trop de modifications. Patientez un instant et réessayez.",
  "mobile.auth.error.photoConflict": "Votre photo a changé sur un autre appareil. Réessayez.",
  "mobile.auth.error.profileSaveFailed":
    "Impossible d’enregistrer votre profil. Vérifiez votre connexion et réessayez.",
  "mobile.auth.error.signOutUnconfirmed":
    "Impossible de confirmer la déconnexion. Vérifiez votre connexion et réessayez.",
} as const satisfies PartialTranslation<typeof source>;
