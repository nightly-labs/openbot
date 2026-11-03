import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  "messaging.help.invalid_token":
    "Slack більше не приймає OpenBot у цьому робочому просторі. Можливо, застосунок видалили. Під’єднайте робочий простір знову.",
  "messaging.help.secret_storage_unavailable":
    "OpenBot не може прочитати збережені токени на цьому комп’ютері. Від’єднайте робочий простір і під’єднайте його знову.",
  "messaging.help.relay_unavailable":
    "OpenBot не може отримувати події Slack на цьому комп’ютері. Увійдіть в обліковий запис, задайте комп’ютеру назву в налаштуваннях сервера й не закривайте OpenBot.",
  "messaging.discordHelp.invalid_token":
    "Discord більше не приймає OpenBot на цьому сервері Discord. Можливо, застосунок видалили. Під’єднайте сервер Discord знову.",
  "messaging.discordHelp.secret_storage_unavailable":
    "OpenBot не може прочитати збережені токени на цьому комп’ютері. Від’єднайте сервер Discord і під’єднайте його знову.",
  "messaging.discordHelp.relay_unavailable":
    "OpenBot не може отримувати події Discord на цьому комп’ютері. Увійдіть в обліковий запис, задайте комп’ютеру назву в налаштуваннях сервера й не закривайте OpenBot.",
} as const satisfies PartialTranslation<typeof source>;
