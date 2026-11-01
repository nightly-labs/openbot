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
  "error.connector.bitwardenHostInput":
    "Wpisz adres serwera HTTPS, client_id i client_secret klucza API oraz hasło główne.",
  "error.connector.bitwardenHostFailed":
    "Nie udało się otworzyć Bitwarden na tym serwerze. Sprawdź adres serwera, klucz API i hasło główne oraz upewnij się, że jeden folder ma nazwę Shared with OpenBot. Następnie połącz ponownie.",
  "error.connector.bitwardenCliInstallFailed":
    "Nie udało się zainstalować Bitwarden CLI na tym serwerze. Sprawdź jego połączenie sieciowe, a następnie połącz ponownie.",
  "error.connector.bitwardenFileUnreadable": "Nie można odczytać pliku połączenia Bitwarden.",
  "error.connector.telegramAccountCredentialsMissing":
    "Wpisz api_id i api_hash swojej aplikacji Telegram. Znajdziesz je na my.telegram.org.",
  "error.connector.telegramAccountCredentialsInvalid":
    "api_id to liczba, a api_hash ma 32 znaki z zakresu 0-9 i a-f. Skopiuj je ponownie z my.telegram.org.",
  "error.connector.telegramAccountApiRejected":
    "Telegram nie akceptuje tego api_id i api_hash. Skopiuj je ponownie z my.telegram.org.",
  "error.connector.telegramAccountPhoneFormat":
    "Wpisz numer telefonu z kierunkowym kraju, na przykład +48 600 100 200.",
  "error.connector.telegramAccountPhoneInvalid":
    "Telegram nie zna tego numeru. Dodaj kierunkowy kraju, na przykład +48.",
  "error.connector.telegramAccountCodeInvalid": "Ten kod jest niepoprawny. Sprawdź go i spróbuj ponownie.",
  "error.connector.telegramAccountCodeEmpty": "Wpisz kod, który wysłał ci Telegram.",
  "error.connector.telegramAccountCodeExpired": "Kod wygasł. Zacznij od nowa, aby dostać nowy kod.",
  "error.connector.telegramAccountPasswordInvalid": "To hasło jest niepoprawne. Spróbuj ponownie.",
  "error.connector.telegramAccountPasswordEmpty": "Wpisz hasło weryfikacji dwuetapowej.",
  "error.connector.telegramAccountPasswordNeeded": "Telegram wymaga hasła weryfikacji dwuetapowej.",
  "error.connector.telegramAccountNoAccount":
    "Ten numer nie ma konta Telegram. Zaloguj się numerem, który już korzysta z Telegrama.",
  "error.connector.telegramAccountPhoneBanned": "Telegram zablokował ten numer.",
  "error.connector.telegramAccountQrExpired": "Kod QR wygasł przed zeskanowaniem. Zacznij od nowa.",
  "error.connector.telegramAccountFloodWait": "Telegram prosi o chwilę przerwy. Spróbuj ponownie za {count} min.",
  "error.connector.telegramAccountCancelled": "Logowanie do Telegrama zostało anulowane.",
  "error.connector.telegramAccountTimedOut": "Logowanie zatrzymało się po 10 minutach bez aktywności. Zacznij od nowa.",
  "error.connector.telegramAccountMovedOn": "Logowanie przeszło do innego kroku. Zacznij od nowa.",
  "error.connector.telegramAccountRefused": "Telegram odrzucił logowanie: {detail}",
  "error.connector.telegramAccountSaveFailed": "OpenBot nie mógł zapisać połączenia z Telegramem: {detail}",
  "error.connector.telegramAccountSessionEnded":
    "Telegram zakończył tę sesję, na przykład w Ustawienia > Urządzenia. Połącz ponownie swoje konto Telegram.",
  "error.connector.telegramAccountFileUnreadable": "Nie można odczytać pliku połączenia z kontem Telegram.",
  "error.connector.telegramAccountFileTooLarge": "Plik połączenia z kontem Telegram jest za duży.",
  "error.connector.whatsappAccountPhoneFormat":
    "Wpisz numer telefonu z kierunkowym kraju, na przykład +48 600 100 200.",
  "error.connector.whatsappAccountPairingFailed": "WhatsApp nie podał kodu: {detail}",
  "error.connector.whatsappAccountQrExpired": "Kod wygasł przed użyciem. Zacznij od nowa.",
  "error.connector.whatsappAccountTimedOut": "Łączenie zatrzymało się po 10 minutach bez aktywności. Zacznij od nowa.",
  "error.connector.whatsappAccountMovedOn": "Łączenie przeszło do innego kroku. Zacznij od nowa.",
  "error.connector.whatsappAccountLinkFailed": "WhatsApp nie połączył tego urządzenia: {detail}",
  "error.connector.whatsappAccountSaveFailed": "OpenBot nie mógł zapisać połączenia z WhatsApp: {detail}",
  "error.connector.whatsappAccountLoggedOut":
    "WhatsApp usunął to urządzenie, na przykład w Ustawienia > Połączone urządzenia. Połącz ponownie swoje konto WhatsApp.",
  "error.connector.whatsappAccountReplaced":
    "Inny program otworzył to połączone urządzenie, więc WhatsApp zamknął tutaj połączenie. Odłącz je, a potem połącz ponownie.",
  "error.connector.whatsappAccountForbidden":
    "WhatsApp odrzucił to urządzenie. Twój numer może być ograniczony. Sprawdź WhatsApp na telefonie.",
  "error.connector.whatsappAccountOutdated":
    "WhatsApp nie akceptuje już tej wersji połączenia. Zaktualizuj OpenBot, a potem połącz ponownie.",
  "error.connector.whatsappAccountOffline":
    "WhatsApp jest teraz niedostępny. OpenBot ponawia próby. Agenci nadal mogą czytać czaty na tym komputerze.",
  "error.connector.whatsappAccountFileUnreadable": "Nie można odczytać pliku połączenia z kontem WhatsApp.",
} as const satisfies PartialTranslation<typeof source>;
