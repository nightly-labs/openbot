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
  "error.connector.githubOffline":
    "OpenBot nie może połączyć się z GitHub. Sprawdź połączenie z internetem i ustawienia DNS komputera lub serwera, na którym działa OpenBot, a potem spróbuj ponownie.",
  "error.connector.githubExpired": "Połączenie z GitHub wygasło. Połącz GitHub ponownie.",
  "error.connector.githubFileUnreadable": "Nie można odczytać pliku połączenia z GitHub.",
  "error.connector.githubFileTooLarge": "Plik połączenia z GitHub jest za duży.",
  "error.connector.nearSignIn": "Zaloguj się do OpenBot, aby korzystać z portfela kryptowalut.",
  "error.connector.nearServiceUnavailable": "Usługa portfela kryptowalut jest niedostępna. Spróbuj ponownie później.",
  "error.connector.nearWalletNotFound": "Ten portfel nie należy do tego konta OpenBot ani do tego serwera.",
  "error.connector.nearWalletLimit": "Dziś utworzono zbyt wiele nowych portfeli. Spróbuj ponownie jutro.",
  "error.connector.nearProviderBusy": "NEAR Intents w tej chwili nie odpowiada. Spróbuj ponownie za kilka minut.",
  "error.connector.nearNoWallet":
    "Portfel kryptowalut nie jest skonfigurowany. Skonfiguruj go w sekcji Ustawienia serwera > Sejf > Krypto.",
  "error.connector.nearWalletExists": "Portfel kryptowalut jest już skonfigurowany.",
  "error.connector.nearFrozen":
    "Płatności z portfela kryptowalut są wstrzymane. Wznów je w sekcji Ustawienia serwera > Sejf > Krypto.",
  "error.connector.nearAgentNotAllowed":
    "Ten agent nie może płacić z portfela kryptowalut. Zezwól na to w sekcji Ustawienia serwera > Sejf > Krypto.",
  "error.connector.nearGrantExpired":
    "OpenBot nie ma zgody na płatności z portfela kryptowalut. Odnów ją w sekcji Ustawienia serwera > Sejf > Krypto.",
  "error.connector.nearUnknownAsset": "Portfel kryptowalut nie ma aktywa {asset}.",
  "error.connector.nearAmountInvalid": "{amount} nie jest prawidłową kwotą {asset}.",
  "error.connector.nearRecipientInvalid": "{recipient} nie jest kontem NEAR ani adresem w formacie chain:address.",
  "error.connector.nearRefused": "NEAR Intents Agent API odrzuciło żądanie: {detail}",
  "error.connector.nearUnexpected": "NEAR Intents Agent API wysłało nieoczekiwaną odpowiedź: {detail}",
  "error.connector.nearUnreachable": "OpenBot nie może połączyć się z NEAR Intents Agent API: {detail}",
  "error.connector.nearFileUnreadable": "Nie można odczytać pliku portfela kryptowalut.",
  "error.connector.nearFileTooLarge": "Plik portfela kryptowalut jest za duży.",
  "error.connector.nearSigningCanceled": "Podpis został anulowany.",
  "error.connector.nearSigningExpired": "Podpis nie dotarł na czas. Spróbuj ponownie.",
  "error.connector.nearSigningInvalid": "Podpis z przeglądarki jest nieprawidłowy.",
  "error.connector.nearSigningBusy": "W przeglądarce czeka już inny podpis. Najpierw go dokończ lub anuluj.",
  "error.connector.nearPolicyCooldown": "Reguły portfela możesz znowu zmienić od {time}.",
  "error.connector.nearPolicyPending": "Zmiana reguł się nie zakończyła. Spróbuj ponownie za kilka minut.",
  "error.connector.nearDeclined": "Właściciel odrzucił płatność.",
  "error.connector.nearUncertain":
    "OpenBot nie wie, czy płatność została wysłana. Nie płać ponownie. Właściciel może sprawdzić historię portfela.",
  "error.connector.nearPaymentFailed": "Płatność nie powiodła się: {detail}",
  "error.connector.nearPaymentUnknown": "Ta płatność nie czeka już na odpowiedź.",
  "error.connector.nearRuleFull": "Reguła płatności może mieć najwyżej {limit} odbiorców.",
  "error.connector.nearRulesFull": "Portfel może mieć najwyżej {limit} reguł płatności.",
  "error.connector.onePasswordCliMissing":
    "OpenBot nie może znaleźć 1Password CLI. Zainstaluj je i włącz jego integrację w aplikacji 1Password albo użyj tokenu konta usługi.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot nie mógł zainstalować 1Password CLI. Sprawdź połączenie z internetem i spróbuj ponownie.",
  "error.connector.onePasswordCliSignedOut":
    "1Password CLI nie jest zalogowane. Włącz jego integrację w aplikacji 1Password, a potem połącz ponownie.",
  "error.connector.onePasswordAppUnreachable":
    "OpenBot nie może połączyć się z aplikacją 1Password. Otwórz 1Password i odblokuj je. W Settings > Developer sprawdź, czy opcja „Integrate with 1Password CLI” jest włączona. Potem spróbuj ponownie.",
  "error.connector.onePasswordCliFailed": "Błąd 1Password CLI: {detail}",
  "error.connector.onePasswordCliForbidden":
    "Twoje konto 1Password nie pozwala Ci utworzyć udostępnionego sejfu ani konta usługi. Poproś właściciela lub administratora konta o to uprawnienie albo o token konta usługi, a potem kliknij „Użyj tokenu”.",
  "error.connector.onePasswordUnexpected": "1Password wysłał nieoczekiwaną odpowiedź: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password nie zaakceptował tokenu konta usługi.",
  "error.connector.onePasswordUnreachable":
    "OpenBot nie mógł połączyć się z 1Password. Sprawdź połączenie z internetem i spróbuj ponownie.",
  "error.connector.onePasswordRateLimited":
    "1Password otrzymał zbyt wiele żądań. Poczekaj kilka minut i spróbuj ponownie.",
  "error.connector.onePasswordRequestLimit":
    "1Password otrzymał zbyt wiele żądań od kont usług. Spróbuj ponownie za 1 godzinę. Jeśli nadal się nie uda, Twoje konto 1Password osiągnęło dzienny limit: spróbuj ponownie za 24 godziny. Wszystkie konta usług Twojego konta liczą się do tego limitu.",
  "error.connector.onePasswordNoVault":
    "Konto usługi nie może odczytać żadnego sejfu. Daj mu dostęp do sejfu i spróbuj ponownie.",
  "error.connector.onePasswordReadFailed":
    "OpenBot nie może odczytać Twoich danych logowania w 1Password. Odłącz 1Password, a potem połącz go ponownie.",
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
  "error.connector.bitwardenHostSignInFailed":
    "Nie udało się zalogować do Bitwarden na tym serwerze. Sprawdź adres serwera i klucz API, a następnie połącz ponownie.",
  "error.connector.bitwardenHostUnlockFailed":
    "Nie udało się odblokować Bitwarden na tym serwerze. Sprawdź hasło główne, a następnie połącz ponownie.",
  "error.connector.bitwardenCliInstallFailed":
    "Nie udało się zainstalować Bitwarden CLI na tym serwerze. Sprawdź jego połączenie sieciowe, a następnie połącz ponownie.",
  "error.connector.bitwardenCliCannotStart":
    "Bitwarden CLI nie uruchomił się na tym serwerze. Połącz ponownie. Jeśli nadal się nie uruchamia, wybierz Pomoc > Zgłoś problem.",
  "error.connector.bitwardenFileUnreadable": "Nie można odczytać pliku połączenia Bitwarden.",
  "error.connector.passwordManagerUnknown": "OpenBot nie zna tego menedżera haseł.",
  "error.connector.passwordManagerMethod": "Tego menedżera haseł nie można połączyć w ten sposób.",
  "error.connector.passwordManagerNoSignIn": "Żadna strona logowania nie jest otwarta. Połącz ponownie.",
  "error.connector.protonPassFailed": "Nie udało się połączyć Proton Pass. Połącz ponownie.",
  "error.connector.protonPassCliInstallFailed":
    "Nie udało się zainstalować Proton Pass CLI. Sprawdź połączenie sieciowe, a potem połącz ponownie.",
  "error.connector.protonPassPlan":
    "Twój plan Proton nie pozwala na Proton Pass CLI. Zmień plan, a potem połącz ponownie.",
  "error.connector.protonPassPlanMissing":
    "Twój plan Proton nie obejmuje Proton Pass CLI. Potrzebny jest plan Proton, który obejmuje Pass Plus. Zmień plan, a potem połącz ponownie.",
  "error.connector.protonPassExpired": "Dostęp do Proton Pass wygasł. Połącz ponownie.",
  "error.connector.protonPassKeyInvalid": "Wpisz klucz dostępu Proton Pass, który zaczyna się od pst_.",
  "error.connector.protonPassExtraPassword": "Dodatkowe hasło jest nieprawidłowe. Wpisz je ponownie.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass nie poprosił o dodatkowe hasło.",
  "error.connector.protonPassFileUnreadable": "Nie można odczytać pliku połączenia Proton Pass.",
  "error.connector.protonPassSignInTimeout": "Logowanie do Proton trwało zbyt długo. Połącz ponownie.",
  "error.connector.protonPassSetupFailed":
    "Nie udało się utworzyć sejfu Shared with OpenBot ani jego klucza dostępu w Proton Pass. Połącz ponownie.",
} as const satisfies PartialTranslation<typeof source>;
