import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.iceServersMissing": "Remote Signal не передал ICE-серверы.",
  "error.host.webRtcNotConfigured": "Служба хоста WebRTC не настроена.",
  "error.host.runtimeNotInstalled": "Среда удалённого рабочего стола не установлена.",
  "error.host.setupUnavailable": "Настройка разрешений недоступна.",
  "error.host.accountChangedDuringUpdate":
    "Аккаунт, в который выполнен вход, изменился во время обновления этого сервера.",
  "error.host.nameBeforePublish": "Дайте этому OpenBot имя, прежде чем публиковать его.",
  "error.host.memberNotFound": "Удалённого участника не существует.",
  "error.host.publishBeforeInvite": "Сделайте этот OpenBot публичным, прежде чем создавать приглашение.",
  "error.host.teamAccessUnavailable": "Доступ вашей команды недоступен.",
  "error.host.ownerIdentityUnavailable": "Идентификатор владельца хоста недоступен.",
  "error.host.reserveAddressFailed": "Не удалось зарезервировать публичный адрес.",
  "error.host.publishFailed": "Не удалось опубликовать этот OpenBot.",
  "error.host.mobileConnectPublishFailed": "Не удалось опубликовать этот OpenBot для Mobile Connect.",
  "error.host.mobileConnectHostChanged": "Хост Mobile Connect изменился. Повторите попытку.",
  "error.host.noServer": "На этом компьютере нет сервера, который можно изменить.",
  "error.host.identityLocalOnly": "Название и логотип сервера можно изменить только на компьютере, где он работает.",
  "error.host.maintenanceInterrupted":
    "Обслуживание хоста прервано. Проверьте приложение и сбросьте состояние хоста, прежде чем повторять.",
  "error.host.updateFailed":
    "Обновление хоста не удалось на этапе {phase}. Проверьте владельца пакета, подпись, состояние тенантов и свободное место на диске, прежде чем сбрасывать состояние.",
  "error.host.tenantsNotIdle": "Тенанты не оставались в простое пять минут подряд в течение двух часов.",
  "error.host.tenantShutdownTimeout": "Время остановки тенантов истекло. Замена приложения не начата.",
  "error.host.tenantHealthMissing":
    "После перезапуска отчёты о состоянии тенантов отсутствуют или показывают сбой. Проверьте сессии тенантов, прежде чем обновлять снова.",
  "error.host.tailscaleUnavailable": "Tailscale недоступен в этой версии OpenBot.",
} as const satisfies PartialTranslation<typeof source>;
