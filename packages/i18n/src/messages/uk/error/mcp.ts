import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Ця адреса недоступна за назвою.",
  "error.mcp.redirectGetOnly": "Ця адреса відповідає лише на GET.",
  "error.mcp.redirectNotSignIn": "Ця адреса не стосується входу.",
  "error.mcp.redirectRefused": "Вхід відхилено. Поверніться в OpenBot і спробуйте ще раз.",
  "error.mcp.redirectNoSignIn": "Жоден сеанс входу не очікує на це. Можливо, він уже завершився.",
  "error.mcp.redirectSignedIn": "OpenBot виконав вхід. Це вікно можна закрити.",
  "error.mcp.signInFileUnreadable": "Файл входу MCP не вдається прочитати.",
  "error.mcp.signInFileTooLarge": "Файл входу MCP завеликий.",
  "error.mcp.unsupported": "Цей сервер не підтримує сервери MCP.",
  "error.mcp.signInOnHost": "Увійти на сервер MCP можна лише в OpenBot на комп’ютері-хості.",
  "error.mcp.signInAppUnsupported": "Цей сервер не підтримує застосунки входу. Оновіть OpenBot на хості.",
  "error.mcp.redirectRelayed": "OpenBot передав вхід на сервер. Це вікно можна закрити.",
  "error.mcp.relayEnded": "Цей вхід завершився. Почніть його знову.",
  "error.mcp.relayNoState":
    "Сторінка входу сервера не захищає свою адресу повернення, тому OpenBot не відкриває її на цьому комп’ютері.",
  "error.mcp.relayAddressInvalid": "Це не та адреса, якою завершується цей вхід. Скопіюйте повну адресу з браузера.",
} as const satisfies PartialTranslation<typeof source>;
