import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/appLock";

export const messages = {
  "mobile.appLock.title": "Bloqueio do app",
  "mobile.appLock.method.pin": "Código PIN",
  "mobile.appLock.method.faceId": "Face ID",
  "mobile.appLock.method.touchId": "Touch ID",
  "mobile.appLock.method.phone": "Desbloqueio do celular",
  "mobile.appLock.methods.title": "Desbloquear com",
  "mobile.appLock.methods.footer":
    "Ative um PIN, {method} ou ambos. O OpenBot será bloqueado quando você sair e pedirá um deles quando você voltar.",
  "mobile.appLock.methods.footerPinOnly":
    "Ative um PIN. O OpenBot será bloqueado quando você sair e pedirá o PIN quando você voltar.",
  "mobile.appLock.changePin": "Alterar PIN",
  "mobile.appLock.lockAfter.title": "Bloquear o OpenBot",
  "mobile.appLock.lockAfter.immediately": "Imediatamente",
  "mobile.appLock.lockAfter.minutes": { one: "Após {count} minuto", other: "Após {count} minutos" },
  "mobile.appLock.lockAfter.hours": { one: "Após {count} hora", other: "Após {count} horas" },
  "mobile.appLock.lockWithPhone": "Quando o celular bloquear",
  "mobile.appLock.lockAfter.footer":
    "O tempo começa quando você sai do OpenBot. O OpenBot sempre é bloqueado ao iniciar de novo.",
  "mobile.appLock.device.turnOnPrompt": "Ativar {method} para o OpenBot",
  "mobile.appLock.device.failed": "{method} não confirmou. Tente novamente.",
  "mobile.appLock.device.unavailable": "Defina primeiro um código no seu celular.",
  "mobile.appLock.pinSetup.title": "Código PIN",
  "mobile.appLock.pinSetup.enter": "Digite um novo PIN de 4 dígitos",
  "mobile.appLock.pinSetup.confirm": "Digite o PIN de novo",
  "mobile.appLock.pinSetup.mismatch": "Os PINs não são iguais. Tente novamente.",
  "mobile.appLock.pinSetup.saveFailed": "Não foi possível salvar o PIN. Tente novamente.",
  "mobile.appLock.lock.title": "O OpenBot está bloqueado",
  "mobile.appLock.lock.confirmTitle": "Confirme que é você",
  "mobile.appLock.lock.enterPin": "Digite seu PIN",
  "mobile.appLock.lock.unlockPrompt": "Desbloquear o OpenBot",
  "mobile.appLock.lock.useDevice": "Usar {method}",
  "mobile.appLock.lock.unlock": "Desbloquear",
  "mobile.appLock.lock.wrongPin": "PIN incorreto.",
  "mobile.appLock.lock.attemptsLeft": {
    one: "PIN incorreto. Resta {count} tentativa antes de sair da conta.",
    other: "PIN incorreto. Restam {count} tentativas antes de sair da conta.",
  },
  "mobile.appLock.lock.waitSeconds": {
    one: "Muitas tentativas. Tente novamente em {count} segundo.",
    other: "Muitas tentativas. Tente novamente em {count} segundos.",
  },
  "mobile.appLock.lock.waitMinutes": {
    one: "Muitas tentativas. Tente novamente em {count} minuto.",
    other: "Muitas tentativas. Tente novamente em {count} minutos.",
  },
  "mobile.appLock.lock.checkFailed": "Não foi possível verificar o PIN. Tente novamente.",
  "mobile.appLock.lock.pinMissing":
    "Este celular não tem um PIN para o OpenBot. Saia da conta para redefinir o bloqueio do app.",
  "mobile.appLock.lock.loadFailed": "Não foi possível ler as configurações do bloqueio do app.",
  "mobile.appLock.lock.retry": "Tentar de novo",
  "mobile.appLock.lock.forgotPin": "Esqueceu o PIN?",
  "mobile.appLock.lock.signOut": "Sair",
  "mobile.appLock.lock.signOutTitle": "Sair do OpenBot?",
  "mobile.appLock.lock.signOutBody":
    "Isso remove o bloqueio do app e desconecta você neste celular. Reconecte-se lendo um novo código do OpenBot no computador.",
  "mobile.appLock.lock.signedOut": "Muitos PINs incorretos. O OpenBot desconectou você neste celular.",
  "mobile.appLock.lock.delete": "Apagar dígito",
  "mobile.appLock.lock.progress": {
    one: "{count} de 4 dígitos digitados",
    other: "{count} de 4 dígitos digitados",
  },
} as const satisfies PartialTranslation<typeof source>;
