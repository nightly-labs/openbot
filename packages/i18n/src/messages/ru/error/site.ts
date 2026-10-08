import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  "error.site.absolutePath": "Укажите абсолютный путь к каталогу сайта.",
  "error.site.rootSymlink": "Символические ссылки в размещаемых сайтах не допускаются.",
  "error.site.notDirectory": "Источник сайта должен быть каталогом.",
  "error.site.outsideWorkspace": "Сайт должен находиться в рабочем пространстве этого агента или в OpenBot Shared.",
  "error.site.packageJsonInvalid": "Файл package.json сайта некорректен.",
  "error.site.astroServerOutput": "Astro должен использовать статический вывод.",
  "error.site.astroAdapter": "Серверные адаптеры Astro и интеграция с React не допускаются.",
  "error.site.astroApiRoutes": "Маршруты API Astro и серверные действия не допускаются.",
  "error.site.astroMiddleware": "Middleware Astro и серверный исходный код не допускаются.",
  "error.site.astroNotBuilt": "Сначала соберите проект Astro. Нужен его существующий каталог dist/.",
  "error.site.astroDistNotDirectory": "Astro dist/ должен быть настоящим каталогом.",
  "error.site.astroDistOutside": "Astro dist/ должен находиться внутри каталога проекта.",
  "error.site.directoryOutsideRoot": "Каталоги сайта должны находиться внутри корня источника.",
  "error.site.siteTooLarge": "Сайт превышает лимит 2 МБ.",
  "error.site.missingIndex": "В корне сайта должен быть index.html.",
  "error.site.symlink": "Символические ссылки не допускаются: {name}",
  "error.site.unsupportedEntry": "Неподдерживаемый элемент сайта: {name}",
  "error.site.tooManyFiles": "Сайт может содержать не более {limit} файлов.",
  "error.site.hiddenFile": "Скрытые файлы не допускаются: {path}",
  "error.site.unsafePath": "Этот путь к файлу не допускается: {path}",
  "error.site.secretFile": "Учётные данные, закрытые ключи и серверный исходный код не допускаются: {path}",
  "error.site.fileType": "Этот тип файла не допускается: {path}",
  "error.site.fileOutsideRoot": "Файлы сайта должны находиться внутри корня источника: {path}",
  "error.site.fileTooLarge": "Файл превышает лимит 1 МБ: {path}",
} as const satisfies PartialTranslation<typeof source>;
