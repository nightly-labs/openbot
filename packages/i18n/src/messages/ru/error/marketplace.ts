import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.timezoneInvalid": "Местный часовой пояс некорректен.",
  "error.marketplace.installedAgentMissing": "Установленного агента больше нет.",
  "error.marketplace.differentListing": "Этот локальный агент был установлен из другого агента каталога.",
  "error.marketplace.marketplaceAvatarInvalid": "Аватар агента каталога некорректен.",
  "error.marketplace.shareCardInvalid": "Карточка для публикации некорректна.",
  "error.marketplace.cannotPublish": "Этого агента нельзя опубликовать.",
  "error.marketplace.templateName": {
    one: "Дайте агенту имя длиной от 1 до {count} символа.",
    few: "Дайте агенту имя длиной от 1 до {count} символов.",
    many: "Дайте агенту имя длиной от 1 до {count} символов.",
    other: "Дайте агенту имя длиной от 1 до {count} символа.",
  },
  "error.marketplace.templateRole": {
    one: "Роль длиннее {count} символа. Сократите её.",
    few: "Роль длиннее {count} символов. Сократите её.",
    many: "Роль длиннее {count} символов. Сократите её.",
    other: "Роль длиннее {count} символа. Сократите её.",
  },
  "error.marketplace.templateNoInstructions": "Добавьте агенту инструкции, прежде чем публиковать его.",
  "error.marketplace.templateInstructions": {
    one: "Инструкции длиннее {count} символа. Сократите их.",
    few: "Инструкции длиннее {count} символов. Сократите их.",
    many: "Инструкции длиннее {count} символов. Сократите их.",
    other: "Инструкции длиннее {count} символа. Сократите их.",
  },
  "error.marketplace.templateAvatar": "Аватар этого агента некорректен. Выберите его заново в настройках агента.",
  "error.marketplace.templateSkills": {
    one: "Агент может опубликовать до {count} навыка. Удалите часть из них.",
    few: "Агент может опубликовать до {count} навыков. Удалите часть из них.",
    many: "Агент может опубликовать до {count} навыков. Удалите часть из них.",
    other: "Агент может опубликовать до {count} навыка. Удалите часть из них.",
  },
  "error.marketplace.templateLocalSkills": {
    one: "Агент может опубликовать до {count} локального навыка. Удалите часть из них.",
    few: "Агент может опубликовать до {count} локальных навыков. Удалите часть из них.",
    many: "Агент может опубликовать до {count} локальных навыков. Удалите часть из них.",
    other: "Агент может опубликовать до {count} локального навыка. Удалите часть из них.",
  },
  "error.marketplace.templateSkill": "Навык «{name}» нельзя опубликовать. Проверьте его имя и SKILL.md.",
  "error.marketplace.templateRoutines": {
    one: "Агент может опубликовать до {count} регулярной задачи. Удалите часть из них.",
    few: "Агент может опубликовать до {count} регулярных задач. Удалите часть из них.",
    many: "Агент может опубликовать до {count} регулярных задач. Удалите часть из них.",
    other: "Агент может опубликовать до {count} регулярной задачи. Удалите часть из них.",
  },
  "error.marketplace.templateRoutine": {
    one: "У регулярной задачи «{name}» должно быть имя длиной до {count} символа и инструкция.",
    few: "У регулярной задачи «{name}» должно быть имя длиной до {count} символов и инструкция.",
    many: "У регулярной задачи «{name}» должно быть имя длиной до {count} символов и инструкция.",
    other: "У регулярной задачи «{name}» должно быть имя длиной до {count} символа и инструкция.",
  },
  "error.marketplace.templateRoutineNoName": "без имени",
  "error.marketplace.templateTooLarge":
    "Этот агент слишком большой для публикации. Сократите его инструкции, навыки или регулярные задачи.",
  "error.marketplace.linkInvalid": "Ссылка на агента некорректна.",
  "error.marketplace.changedSinceOpened":
    "Агент изменился после того, как вы его открыли. Откройте ссылку снова, чтобы посмотреть новую версию.",
  "error.marketplace.skillNameConflict":
    "У вас уже есть другой локальный навык с именем «{name}». Переименуйте или удалите его и добавьте агента снова.",
  "error.marketplace.avatarInvalid": "Аватар агента некорректен.",
  "error.marketplace.secretInName": "Удалите секрет или адрес электронной почты из имени, прежде чем публиковать.",
  "error.marketplace.secretInTitle": "Удалите секрет или адрес электронной почты из названия, прежде чем публиковать.",
  "error.marketplace.secretInInstructions":
    "Удалите секрет или адрес электронной почты из инструкций, прежде чем публиковать.",
  "error.marketplace.secretInRoutine":
    "Удалите секрет или адрес электронной почты из регулярной задачи «{name}», прежде чем публиковать.",
  "error.marketplace.secretInSkill":
    "Удалите секрет или адрес электронной почты из навыка «{name}», прежде чем публиковать.",
  "error.marketplace.catalogLoadFailed": "Не удалось загрузить каталог. Повторите попытку.",
  "error.marketplace.templateUnreadable": "Не удалось прочитать этого общего агента. Возможно, владелец удалил его.",
} as const satisfies PartialTranslation<typeof source>;
