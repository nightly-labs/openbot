import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.setupMacOnly": "Konfiguracja uprawnień jest dostępna w macOS.",
  "status.remote.setupInstallHost": "Zainstaluj komponent hosta zdalnego pulpitu, a potem sprawdź ponownie.",
  "status.remote.setupUpdateRuntime": "Zaktualizuj środowisko zdalnego pulpitu, aby sprawdzić uprawnienia macOS.",
  "status.remote.setupCheckFailed":
    "Sunshine nie mógł ukończyć sprawdzania uprawnień. Sprawdź sesję hosta i spróbuj ponownie.",
  "status.remote.setupServiceFailed":
    "Nie udało się uruchomić usługi zdalnego pulpitu. Sprawdź, czy ten użytkownik macOS ma aktywną sesję graficzną.",
  "status.remote.connectingSunshine": "Łączenie przez Sunshine…",
  "status.remote.switchingMonitor": "Przełączanie udostępnianego monitora…",
  "status.remote.controlConnected": "Zdalne sterowanie połączone.",
  "status.remote.controlFailed": "Zdalne sterowanie nie powiodło się.",
  "status.remote.stagePreferences": "Wczytywanie lokalnych preferencji czatu: {reason}",
  "status.remote.stageConnection": "Łączenie z komputerem: {reason}",
  "status.remote.stageCompatibility": "Sprawdzanie zgodności z komputerem: {reason}",
  "status.remote.stageAgents": "Wczytywanie agentów: {reason}",
  "status.remote.stageReads": "Wczytywanie stanu przeczytania: {reason}",
  "status.remote.stageConversations": "Wczytywanie rozmów: {reason}",
  "status.remote.suspendedDetail": "Zaktualizuj OpenBot Mobile lub aplikację desktopową przed połączeniem.\n{detail}",
  "status.remote.cooldownDetail":
    "Połączenie nie powiodło się po {limit} próbach. Ponowna próba za {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "Połączenie nie powiodło się po {limit} próbach. Ponowna próba za {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Utracono połączenie. Ponowna próba za {count} s.\n{detail}",
    few: "Utracono połączenie. Ponowna próba za {count} s.\n{detail}",
    many: "Utracono połączenie. Ponowna próba za {count} s.\n{detail}",
    other: "Utracono połączenie. Ponowna próba za {count} s.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Utracono połączenie. Ponowna próba za {count} s.",
    few: "Utracono połączenie. Ponowna próba za {count} s.",
    many: "Utracono połączenie. Ponowna próba za {count} s.",
    other: "Utracono połączenie. Ponowna próba za {count} s.",
  },
  "status.remote.attemptFailedDetail": {
    one: "Próba połączenia nie powiodła się. Ponowna próba za {count} s.\n{detail}",
    few: "Próba połączenia nie powiodła się. Ponowna próba za {count} s.\n{detail}",
    many: "Próba połączenia nie powiodła się. Ponowna próba za {count} s.\n{detail}",
    other: "Próba połączenia nie powiodła się. Ponowna próba za {count} s.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "Próba połączenia nie powiodła się. Ponowna próba za {count} s.",
    few: "Próba połączenia nie powiodła się. Ponowna próba za {count} s.",
    many: "Próba połączenia nie powiodła się. Ponowna próba za {count} s.",
    other: "Próba połączenia nie powiodła się. Ponowna próba za {count} s.",
  },
  "status.remote.reconnectingDetail": {
    one: "Ponowne łączenie {attempt}/{count}\n{detail}",
    few: "Ponowne łączenie {attempt}/{count}\n{detail}",
    many: "Ponowne łączenie {attempt}/{count}\n{detail}",
    other: "Ponowne łączenie {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": {
    one: "Ponowne łączenie {attempt}/{count}",
    few: "Ponowne łączenie {attempt}/{count}",
    many: "Ponowne łączenie {attempt}/{count}",
    other: "Ponowne łączenie {attempt}/{count}",
  },
} as const satisfies PartialTranslation<typeof source>;
