import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "Sterownik Sterowania komputerem się nie uruchomił. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer":
    "Sterownik Sterowania komputerem zatrzymał się, zanim zdążył odpowiedzieć.",
  "status.computerUse.driverNoAnswer": "Sterownik Sterowania komputerem nie odpowiedział. {reason}",
  "status.computerUse.driverStopped": "Sterownik Sterowania komputerem się zatrzymał.",
  "status.computerUse.unsupported": "Sterowanie komputerem jest dostępne w systemach macOS, Windows i Linux.",
  "status.computerUse.driverMissing": "Ta wersja OpenBot nie zawiera sterownika Sterowania komputerem.",
  "status.computerUse.inputRefused":
    "Na tym pulpicie OpenBot nie może pisać ani klikać w innych aplikacjach. Przy zadaniach na stronach internetowych poproś agenta, aby użył przeglądarki OpenBot.",
  "status.computerUse.progressActing": "Korzysta z aplikacji na tym komputerze…",
  "status.computerUse.progressDeciding": "Wybiera następny krok w aplikacji…",
} as const satisfies PartialTranslation<typeof source>;
