import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.timezoneInvalid": "Місцевий часовий пояс некоректний.",
  "error.marketplace.installedAgentMissing": "Установленого агента більше не існує.",
  "error.marketplace.differentListing": "Цього локального агента встановлено з іншого агента каталогу.",
  "error.marketplace.marketplaceAvatarInvalid": "Аватар агента каталогу некоректний.",
  "error.marketplace.shareCardInvalid": "Картка для поширення некоректна.",
  "error.marketplace.cannotPublish": "Цього агента не можна опублікувати.",
  "error.marketplace.templateName": {
    one: "Дайте агенту назву довжиною від 1 до {count} символу.",
    few: "Дайте агенту назву довжиною від 1 до {count} символів.",
    many: "Дайте агенту назву довжиною від 1 до {count} символів.",
    other: "Дайте агенту назву довжиною від 1 до {count} символу.",
  },
  "error.marketplace.templateRole": {
    one: "Роль перевищує {count} символ. Скоротіть її.",
    few: "Роль перевищує {count} символи. Скоротіть її.",
    many: "Роль перевищує {count} символів. Скоротіть її.",
    other: "Роль перевищує {count} символу. Скоротіть її.",
  },
  "error.marketplace.templateNoInstructions": "Додайте агенту інструкції, перш ніж публікувати його.",
  "error.marketplace.templateInstructions": {
    one: "Інструкції перевищують {count} символ. Скоротіть їх.",
    few: "Інструкції перевищують {count} символи. Скоротіть їх.",
    many: "Інструкції перевищують {count} символів. Скоротіть їх.",
    other: "Інструкції перевищують {count} символу. Скоротіть їх.",
  },
  "error.marketplace.templateAvatar": "Аватар цього агента некоректний. Виберіть його знову в налаштуваннях агента.",
  "error.marketplace.templateSkills": {
    one: "Агент може опублікувати до {count} навички. Видаліть деякі з них.",
    few: "Агент може опублікувати до {count} навичок. Видаліть деякі з них.",
    many: "Агент може опублікувати до {count} навичок. Видаліть деякі з них.",
    other: "Агент може опублікувати до {count} навички. Видаліть деякі з них.",
  },
  "error.marketplace.templateLocalSkills": {
    one: "Агент може опублікувати до {count} локальної навички. Видаліть деякі з них.",
    few: "Агент може опублікувати до {count} локальних навичок. Видаліть деякі з них.",
    many: "Агент може опублікувати до {count} локальних навичок. Видаліть деякі з них.",
    other: "Агент може опублікувати до {count} локальної навички. Видаліть деякі з них.",
  },
  "error.marketplace.templateSkill": "Навичку «{name}» не можна опублікувати. Перевірте її назву та SKILL.md.",
  "error.marketplace.templateRoutines": {
    one: "Агент може опублікувати до {count} регулярного завдання. Видаліть деякі з них.",
    few: "Агент може опублікувати до {count} регулярних завдань. Видаліть деякі з них.",
    many: "Агент може опублікувати до {count} регулярних завдань. Видаліть деякі з них.",
    other: "Агент може опублікувати до {count} регулярного завдання. Видаліть деякі з них.",
  },
  "error.marketplace.templateRoutine": {
    one: "Регулярне завдання «{name}» має мати назву до {count} символу та інструкцію.",
    few: "Регулярне завдання «{name}» має мати назву до {count} символів та інструкцію.",
    many: "Регулярне завдання «{name}» має мати назву до {count} символів та інструкцію.",
    other: "Регулярне завдання «{name}» має мати назву до {count} символу та інструкцію.",
  },
  "error.marketplace.templateRoutineNoName": "без назви",
  "error.marketplace.templateTooLarge":
    "Цей агент завеликий для публікації. Скоротіть його інструкції, навички або регулярні завдання.",
  "error.marketplace.linkInvalid": "Посилання на агента некоректне.",
  "error.marketplace.changedSinceOpened":
    "Агент змінився після того, як ви його відкрили. Відкрийте посилання знову, щоб переглянути нову версію.",
  "error.marketplace.skillNameConflict":
    "У вас уже є інша локальна навичка з назвою «{name}». Перейменуйте або видаліть її і додайте агента знову.",
  "error.marketplace.avatarInvalid": "Аватар агента некоректний.",
  "error.marketplace.secretInName": "Видаліть секрет або адресу електронної пошти з імені, перш ніж публікувати.",
  "error.marketplace.secretInTitle": "Видаліть секрет або адресу електронної пошти з назви, перш ніж публікувати.",
  "error.marketplace.secretInInstructions":
    "Видаліть секрет або адресу електронної пошти з інструкцій, перш ніж публікувати.",
  "error.marketplace.secretInRoutine":
    "Видаліть секрет або адресу електронної пошти з регулярного завдання «{name}», перш ніж публікувати.",
  "error.marketplace.secretInSkill":
    "Видаліть секрет або адресу електронної пошти з навички «{name}», перш ніж публікувати.",
  "error.marketplace.catalogLoadFailed": "Не вдалося завантажити каталог. Спробуйте ще раз.",
  "error.marketplace.templateUnreadable": "Не вдалося прочитати цього спільного агента. Можливо, власник його видалив.",
} as const satisfies PartialTranslation<typeof source>;
