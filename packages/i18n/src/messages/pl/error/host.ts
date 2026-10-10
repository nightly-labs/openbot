import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.iceServersMissing": "Remote Signal nie dostarczył serwerów ICE.",
  "error.host.webRtcNotConfigured": "Usługa hosta WebRTC nie jest skonfigurowana.",
  "error.host.runtimeNotInstalled": "Środowisko zdalnego pulpitu nie jest zainstalowane.",
  "error.host.setupUnavailable": "Konfiguracja uprawnień nie jest dostępna.",
  "error.host.accountChangedDuringUpdate": "Zalogowane konto zmieniło się podczas aktualizacji tego serwera.",
  "error.host.nameBeforePublish": "Nadaj nazwę temu OpenBot, zanim go opublikujesz.",
  "error.host.memberNotFound": "Zdalny członek nie istnieje.",
  "error.host.publishBeforeInvite": "Upublicznij ten OpenBot, zanim utworzysz zaproszenie.",
  "error.host.teamAccessUnavailable": "Twój dostęp do zespołu jest niedostępny.",
  "error.host.ownerIdentityUnavailable": "Tożsamość właściciela hosta jest niedostępna.",
  "error.host.reserveAddressFailed": "Nie udało się zarezerwować adresu publicznego.",
  "error.host.publishFailed": "Nie udało się opublikować tego OpenBot.",
  "error.host.mobileConnectPublishFailed": "Nie udało się opublikować tego OpenBot dla Mobile Connect.",
  "error.host.mobileConnectHostChanged": "Host Mobile Connect się zmienił. Spróbuj ponownie.",
  "error.host.noServer": "Ten komputer nie ma serwera do zmiany.",
  "error.host.identityLocalOnly": "Nazwę i logo serwera można zmienić tylko na komputerze, na którym działa.",
  "error.host.maintenanceInterrupted":
    "Przerwano konserwację hosta. Sprawdź aplikację i zresetuj stan hosta, zanim spróbujesz ponownie.",
  "error.host.updateFailed":
    "Aktualizacja hosta nie powiodła się w fazie {phase}. Sprawdź własność pakietu, podpis, stan tenantów i wolne miejsce na dysku, zanim zresetujesz stan.",
  "error.host.tenantsNotIdle": "Tenanty nie pozostały bezczynne przez pięć minut w ciągu dwóch godzin.",
  "error.host.tenantShutdownTimeout": "Upłynął limit czasu zamykania tenantów. Nie rozpoczęto zastępowania aplikacji.",
  "error.host.tenantHealthMissing":
    "Po ponownym uruchomieniu brakuje raportów stanu tenantów lub wskazują one problem. Sprawdź sesje tenantów przed kolejną aktualizacją.",
} as const satisfies PartialTranslation<typeof source>;
