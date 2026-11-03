import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

// Not translated yet: the screen shows the English text.
export const messages = {
  "error.messaging.notConnected": "Цей робочий простір Slack не під’єднано.",
  "error.messaging.unsupported": "Цей комп’ютер не може під’єднатися до Slack.",
  "error.messaging.relayUnavailable":
    "OpenBot не може отримувати події Slack на цьому комп’ютері. Увійдіть, дайте комп’ютеру назву і спробуйте ще раз.",
  "error.messaging.discordNotConnected": "Цей сервер Discord не під’єднано.",
  "error.messaging.discordUnsupported": "Цей комп’ютер не може під’єднатися до Discord.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot не може отримувати події Discord на цьому комп’ютері. Увійдіть, дайте комп’ютеру назву і спробуйте ще раз.",
  "error.messaging.discordRolesUnsupported": "OpenBot поки не може показати ролі Discord. Спробуйте пізніше.",
  "error.messaging.telegramNotConnected": "Цей чат Telegram не під’єднано.",
  "error.messaging.telegramUnsupported": "Цей комп’ютер не може під’єднатися до Telegram.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot не може зв’язатися з Telegram на цьому комп’ютері. Увійдіть, дайте комп’ютеру назву і спробуйте ще раз.",
  "error.messaging.telegramServiceUnavailable": "OpenBot зараз не може під’єднати Telegram. Спробуйте пізніше.",
  "error.messaging.memoryLimit":
    "Під’єднаний робочий простір може мати не більше {limit} записів пам’яті. Спершу видаліть один.",
} as const satisfies PartialTranslation<typeof source>;
