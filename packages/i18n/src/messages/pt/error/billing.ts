import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "Não foi possível mudar o plano do servidor. Atualize a Cobrança e tente de novo.",
  "error.billing.confirmMismatch": "Digite o nome do servidor para excluí-lo.",
  "error.billing.restartBusy": "O servidor não pode reiniciar agora. Tente de novo em um minuto.",
  "error.billing.restartUnavailable": "Este servidor não pode reiniciar por aqui. Fale com o suporte.",
  "error.billing.planRequired": "O plano deste servidor terminou. Renove-o para iniciar o servidor.",
  "error.billing.planSoldOut": "Este plano está esgotado. Escolha outro plano.",
  "error.billing.storageUnavailable": "Este armazenamento não está disponível para este servidor.",
  "error.billing.storagePaymentFailed":
    "O pagamento do armazenamento falhou. Atualize a forma de pagamento e tente novamente.",
  "error.billing.licenseExists": "Esta conta já tem uma licença. Altere os usuários dela em vez disso.",
  "error.billing.licenseCurrency": "A licença precisa usar a moeda dos seus outros planos.",
  "error.billing.planCurrency": "Um novo plano precisa usar a moeda dos seus outros planos.",
  "error.billing.licenseUsersInUse": "A licença não pode ter menos usuários do que as pessoas que a usam agora.",
  "error.billing.licensePaymentFailed":
    "O pagamento dos usuários adicionados falhou. Atualize a forma de pagamento e tente novamente.",
  "error.billing.licenseUnavailable": "As licenças não estão disponíveis agora.",
  "error.billing.licenseOneUser": "Esta licença é para 1 usuário. Mude para Team para adicionar usuários.",
  "error.billing.licensePlanChange": "Esta licença não pode mudar para esse plano. Cancele-a e compre o novo plano.",
  "error.billing.noLicense": "Esta conta não tem licença.",
  "error.billing.countryRequired":
    "Informe o país de cobrança antes de pagar. Atualize o OpenBot para fazer isso e tente novamente.",
  "error.billing.detailsInvalid": "Verifique o país e o número de IVA. O número de IVA deve ser do país escolhido.",
  "error.billing.vatIdInvalid":
    "O sistema de IVA da UE não conhece este número de IVA. Verifique o número ou continue sem número de IVA.",
  "error.billing.vatIdUnverified":
    "O sistema de IVA da UE não pode verificar o número de IVA agora. Tente mais tarde ou continue sem número de IVA.",
  "error.billing.vatUnavailable": "O pagamento não está disponível agora. Tente mais tarde.",
  "error.billing.invalidRequest": "A solicitação de cobrança é inválida.",
  "error.billing.invalidResponse": "A resposta de cobrança é inválida.",
  "error.billing.notStripePage": "A página de cobrança não é uma página do Stripe.",
} as const satisfies PartialTranslation<typeof source>;
