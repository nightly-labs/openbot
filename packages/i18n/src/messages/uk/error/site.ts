import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  "error.site.absolutePath": "Вкажіть абсолютний шлях до каталогу сайту.",
  "error.site.rootSymlink": "Символічні посилання в розміщених сайтах заборонені.",
  "error.site.notDirectory": "Джерелом сайту має бути каталог.",
  "error.site.outsideWorkspace": "Сайт має бути в робочому просторі цього агента або в OpenBot Shared.",
  "error.site.packageJsonInvalid": "Файл package.json сайту некоректний.",
  "error.site.astroServerOutput": "Astro має використовувати статичний вивід.",
  "error.site.astroAdapter": "Серверні адаптери Astro та інтеграція з React заборонені.",
  "error.site.astroApiRoutes": "Маршрути API Astro і серверні дії заборонені.",
  "error.site.astroMiddleware": "Middleware Astro і серверний вихідний код заборонені.",
  "error.site.astroNotBuilt": "Спершу зберіть проєкт Astro. Потрібен його наявний каталог dist/.",
  "error.site.astroDistNotDirectory": "Astro dist/ має бути справжнім каталогом.",
  "error.site.astroDistOutside": "Astro dist/ має залишатися в каталозі проєкту.",
  "error.site.directoryOutsideRoot": "Каталоги сайту мають залишатися в кореневому каталозі джерела.",
  "error.site.siteTooLarge": "Сайт перевищує ліміт 2 МБ.",
  "error.site.missingIndex": "Кореневий каталог сайту має містити index.html.",
  "error.site.symlink": "Символічні посилання заборонені: {name}",
  "error.site.unsupportedEntry": "Непідтримуваний елемент сайту: {name}",
  "error.site.tooManyFiles": "Сайт може містити не більше {limit} файлів.",
  "error.site.hiddenFile": "Приховані файли заборонені: {path}",
  "error.site.unsafePath": "Цей шлях до файлу заборонений: {path}",
  "error.site.secretFile": "Облікові дані, закриті ключі та серверний вихідний код заборонені: {path}",
  "error.site.fileType": "Цей тип файлу заборонений: {path}",
  "error.site.fileOutsideRoot": "Файли сайту мають залишатися в кореневому каталозі джерела: {path}",
  "error.site.fileTooLarge": "Файл перевищує ліміт 1 МБ: {path}",
} as const satisfies PartialTranslation<typeof source>;
