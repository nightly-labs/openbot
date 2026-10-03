import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  // Errors from host setup, publishing, and host maintenance.
  "error.host.iceServersMissing": "Uzak Sinyal ICE sunucuları sağlamadı.",
  "error.host.webRtcNotConfigured": "WebRTC ana makine hizmeti yapılandırılmamış.",
  "error.host.runtimeNotInstalled": "Uzak masaüstü çalışma zamanı kurulu değil.",
  "error.host.setupUnavailable": "İzin kurulumu kullanılamıyor.",
  "error.host.accountChangedDuringUpdate": "Bu sunucu güncellenirken oturum açmış hesap değişti.",
  "error.host.nameBeforePublish": "Yayınlamadan önce bu OpenBot'a bir ad verin.",
  "error.host.memberNotFound": "Uzak üye mevcut değil.",
  "error.host.publishBeforeInvite": "Davet oluşturmadan önce bu OpenBot'u herkese açık hale getirin.",
  "error.host.teamAccessUnavailable": "Ekip erişiminiz kullanılamıyor.",
  "error.host.ownerIdentityUnavailable": "Ana makine sahibi kimliği kullanılamıyor.",
  "error.host.reserveAddressFailed": "Genel adres rezerve edilemedi.",
  "error.host.publishFailed": "Bu OpenBot yayınlanamadı.",
  "error.host.mobileConnectPublishFailed": "Bu OpenBot Mobile Connect için yayınlanamadı.",
  "error.host.mobileConnectHostChanged": "Mobile Connect ana makinesi değişti. Tekrar deneyin.",
  "error.host.noServer": "Bu bilgisayarda değiştirilecek bir sunucu yok.",
  "error.host.identityLocalOnly": "Sunucu adı ve logosu yalnızca onu çalıştıran bilgisayarda değiştirilebilir.",
  "error.host.maintenanceInterrupted":
    "Ana makine bakımı kesintiye uğradı. Tekrar denemeden önce uygulamayı doğrulayın ve ana makine durumunu sıfırlayın.",
  "error.host.updateFailed":
    "{phase} sırasında ana makine güncellemesi başarısız oldu. Durumu sıfırlamadan önce paket sahipliğini, imzalamayı, kiracı durumunu ve boş disk alanını doğrulayın.",
  "error.host.tenantsNotIdle": "Kiracılar iki saat içinde beş dakika boşta kalmadı.",
  "error.host.tenantShutdownTimeout": "Kiracı kapatması zaman aşımına uğradı. Hiçbir uygulama değişimi başlatılmadı.",
  "error.host.tenantHealthMissing":
    "Yeniden başlatmanın ardından kiracı sağlık raporları eksik veya sağlıksız. Başka bir güncellemeden önce kiracı oturumlarını inceleyin.",
} as const satisfies PartialTranslation<typeof source>;
