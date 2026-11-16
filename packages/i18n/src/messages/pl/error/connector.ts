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
  "error.connector.bitwardenCliMissing":
    "OpenBot nie może znaleźć Bitwarden CLI. Zainstaluj bw, sprawdź, czy działa w nowym terminalu, a potem połącz ponownie.",
  "error.connector.bitwardenFolderMissing":
    "Bitwarden musi mieć dokładnie jeden folder o nazwie Shared with OpenBot. Utwórz go lub usuń dodatkowy folder, a potem połącz ponownie.",
  "error.connector.bitwardenHostInput":
    "Wpisz adres serwera HTTPS, client_id i client_secret klucza API oraz hasło główne.",
  "error.connector.bitwardenHostFailed":
    "Nie udało się otworzyć Bitwarden na tym serwerze. Sprawdź adres serwera, klucz API i hasło główne oraz upewnij się, że jeden folder ma nazwę Shared with OpenBot. Następnie połącz ponownie.",
  "error.connector.bitwardenCliInstallFailed":
    "Nie udało się zainstalować Bitwarden CLI na tym serwerze. Sprawdź jego połączenie sieciowe, a następnie połącz ponownie.",
  "error.connector.bitwardenFileUnreadable": "Nie można odczytać pliku połączenia Bitwarden.",
  "error.connector.passwordManagerUnknown": "OpenBot nie zna tego menedżera haseł.",
  "error.connector.passwordManagerMethod": "Tego menedżera haseł nie można połączyć w ten sposób.",
  "error.connector.passwordManagerNoSignIn": "Żadna strona logowania nie jest otwarta. Połącz ponownie.",
  "error.connector.protonPassFailed": "Nie udało się połączyć Proton Pass. Połącz ponownie.",
  "error.connector.protonPassCliInstallFailed":
    "Nie udało się zainstalować Proton Pass CLI. Sprawdź połączenie sieciowe, a potem połącz ponownie.",
  "error.connector.protonPassPlan":
    "Twój plan Proton nie pozwala na Proton Pass CLI. Zmień plan, a potem połącz ponownie.",
  "error.connector.protonPassExpired": "Dostęp do Proton Pass wygasł. Połącz ponownie.",
  "error.connector.protonPassKeyInvalid": "Wpisz klucz dostępu Proton Pass, który zaczyna się od pst_.",
  "error.connector.protonPassExtraPassword": "Dodatkowe hasło jest nieprawidłowe. Wpisz je ponownie.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass nie poprosił o dodatkowe hasło.",
  "error.connector.protonPassFileUnreadable": "Nie można odczytać pliku połączenia Proton Pass.",
  "error.connector.protonPassSignInTimeout": "Logowanie do Proton trwało zbyt długo. Połącz ponownie.",
  "error.connector.protonPassSetupFailed":
    "Nie udało się utworzyć sejfu Shared with OpenBot ani jego klucza dostępu w Proton Pass. Połącz ponownie.",
} as const satisfies PartialTranslation<typeof source>;
