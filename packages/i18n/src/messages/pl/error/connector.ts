import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "Ta kompilacja OpenBot nie zawiera GitHub App.",
  "error.connector.githubDenied": "Logowanie do GitHub zostało odrzucone.",
  "error.connector.githubCodeExpired": "Kod GitHub wygasł. Połącz GitHub ponownie.",
  "error.connector.githubDeviceFlowDisabled": "GitHub App nie zezwala na logowanie kodem urządzenia.",
  "error.connector.githubClientUnknown": "GitHub nie zna Client ID tej GitHub App.",
  "error.connector.githubUnexpected": "GitHub wysłał nieoczekiwaną odpowiedź: {detail}",
  "error.connector.githubUnreachable": "OpenBot nie może połączyć się z GitHub: {detail}",
  "error.connector.githubExpired": "Połączenie z GitHub wygasło. Połącz GitHub ponownie.",
  "error.connector.githubFileUnreadable": "Nie można odczytać pliku połączenia z GitHub.",
  "error.connector.githubFileTooLarge": "Plik połączenia z GitHub jest za duży.",
  "error.connector.onePasswordCliMissing":
    "OpenBot nie może znaleźć 1Password CLI. Zainstaluj je i włącz jego integrację w aplikacji 1Password albo użyj tokenu konta usługi.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot nie mógł zainstalować 1Password CLI. Sprawdź połączenie z internetem i spróbuj ponownie.",
  "error.connector.onePasswordCliSignedOut":
    "1Password CLI nie jest zalogowane. Włącz jego integrację w aplikacji 1Password, a potem połącz ponownie.",
  "error.connector.onePasswordCliFailed": "Błąd 1Password CLI: {detail}",
  "error.connector.onePasswordUnexpected": "1Password wysłał nieoczekiwaną odpowiedź: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password nie zaakceptował tokenu konta usługi.",
  "error.connector.onePasswordNoVault":
    "Konto usługi nie może odczytać żadnego sejfu. Daj mu dostęp do sejfu i spróbuj ponownie.",
  "error.connector.onePasswordFileUnreadable": "Nie można odczytać pliku połączenia z 1Password.",
  "error.connector.onePasswordFileTooLarge": "Plik połączenia z 1Password jest za duży.",
  "error.connector.bitwardenFailed":
    "Nie udało się odczytać danych Bitwarden. Zainstaluj bw CLI, zaloguj się, odblokuj je i utwórz jeden folder o nazwie Shared with OpenBot. Połącz ponownie z nowym kluczem sesji.",
} as const satisfies PartialTranslation<typeof source>;
