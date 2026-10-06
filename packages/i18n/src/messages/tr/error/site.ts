import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  // Barındırılan site hataları.
  "error.site.absolutePath": "Mutlak bir site dizini yolu seçin.",
  "error.site.rootSymlink": "Barındırılan sitelerde sembolik bağlantılara izin verilmez.",
  "error.site.notDirectory": "Site kaynağı bir dizin olmalıdır.",
  "error.site.outsideWorkspace": "Site, bu ajanın çalışma alanı veya OpenBot Paylaşılan klasörü içinde olmalıdır.",
  "error.site.packageJsonInvalid": "Sitenin package.json dosyası geçersiz.",
  "error.site.astroServerOutput": "Astro statik çıktı kullanmalıdır.",
  "error.site.astroAdapter": "Astro sunucu bağdaştırıcılarına ve React entegrasyonuna izin verilmez.",
  "error.site.astroApiRoutes": "Astro API rotalarına ve sunucu eylemlerine izin verilmez.",
  "error.site.astroMiddleware": "Astro ara yazılımına ve sunucu kaynağına izin verilmez.",
  "error.site.astroNotBuilt": "Önce Astro projesini derleyin. Mevcut dist/ dizini gereklidir.",
  "error.site.astroDistNotDirectory": "Astro dist/ gerçek bir dizin olmalıdır.",
  "error.site.astroDistOutside": "Astro dist/ proje dizini içinde kalmalıdır.",
  "error.site.directoryOutsideRoot": "Site dizinleri kaynak kökü içinde kalmalıdır.",
  "error.site.siteTooLarge": "Site 2 MB sınırını aşıyor.",
  "error.site.missingIndex": "Site kökü index.html içermelidir.",
  "error.site.symlink": "Sembolik bağlantılara izin verilmez: {name}",
  "error.site.unsupportedEntry": "Desteklenmeyen site girdisi: {name}",
  "error.site.tooManyFiles": "Bir site en fazla {limit} dosya içerebilir.",
  "error.site.hiddenFile": "Gizli dosyalara izin verilmez: {path}",
  "error.site.unsafePath": "Bu dosya yoluna izin verilmez: {path}",
  "error.site.secretFile": "Kimlik bilgileri, özel anahtarlar ve sunucu kaynak koduna izin verilmez: {path}",
  "error.site.fileType": "Bu dosya türüne izin verilmez: {path}",
  "error.site.fileOutsideRoot": "Site dosyaları kaynak kökünün içinde kalmalıdır: {path}",
  "error.site.fileTooLarge": "Bir dosya 1 MB sınırını aşıyor: {path}",
} as const satisfies PartialTranslation<typeof source>;
