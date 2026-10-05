import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.accountConfirmMismatch": "Hesabı silmek için hesabın e-posta adresini yazın.",
  "error.auth.accountHasHostedServers": "Hesabı silmeden önce barındırılan sunucularınızı silin.",
} as const satisfies PartialTranslation<typeof source>;
