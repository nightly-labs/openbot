import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/crm";

export const messages = {
  "error.crm.serverTooOld": "Este servidor não oferece suporte ao CRM. Atualize o OpenBot no computador que o executa.",
  "error.crm.tooLargeToSend": "Esta página do CRM é grande demais para enviar a este aplicativo.",
  "error.crm.customerMissing": "Este cliente não existe mais.",
  "error.crm.planMissing": "Este plano não existe mais.",
  "error.crm.paymentMissing": "Este pagamento não existe mais.",
  "error.crm.tagMissing": "Esta tag não existe mais.",
  "error.crm.statusMissing": "Este status não existe mais.",
  "error.crm.proposalMissing": "Esta sugestão não existe mais ou já foi decidida.",
  "error.crm.tagExists": "Já existe uma tag com este nome.",
  "error.crm.statusExists": "Já existe um status com este nome.",
  "error.crm.builtinStatus": "Não é possível renomear nem excluir um status padrão.",
  "error.crm.tooManyStatuses": "O CRM já tem o número máximo de status. Exclua um status primeiro.",
  "error.crm.tooManyTags": "O CRM já tem o número máximo de tags. Exclua uma tag primeiro.",
  "error.crm.tooManyPlans": "Este cliente já tem o número máximo de planos. Exclua um plano primeiro.",
  "error.crm.paymentPaid": "Este pagamento está pago. Marque-o como não pago primeiro.",
  "error.crm.splitTotal": "A soma das partes deve ser igual ao valor do pagamento.",
  "error.crm.planEndsBeforeStart": "Um plano não pode terminar antes de começar.",
  "error.crm.currencyInUse": "Não é possível alterar a moeda de um cliente que tem planos ou pagamentos.",
  "error.crm.badCursor": "Esta página não é mais válida. Carregue a lista de novo.",
  "error.crm.invalidChange": "Esta alteração não é válida.",
  "error.crm.agentNotAllowed":
    "Este agente não pode usar o CRM. Um proprietário ou administrador pode liberar o acesso: abra a página do CRM, clique em Sugestões, clique no botão com o número de agentes e ative este agente.",
  "error.crm.tooManyProposals": "Há sugestões demais aguardando decisão. Aguarde até que uma pessoa as decida.",
  "error.crm.amountInvalid": "Escreva o valor como número, por exemplo 129.00.",
  "error.crm.amountDecimals": "O valor tem casas decimais demais para {currency}.",
  "error.crm.fieldPrivate": "Este campo é privado. Os agentes não podem lê-lo nem filtrar por ele.",
  "error.crm.sourceOwned":
    "O Stripe mantém esta linha. Altere-a no Stripe; o CRM recebe a alteração na próxima sincronização.",
  "error.crm.sourceConnected": "O Stripe já está conectado a este CRM.",
  "error.crm.sourceMissing": "Esta conexão com o Stripe não existe mais.",
  "error.crm.sourceSecretKey":
    "Esta é uma chave secreta, que pode alterar sua conta do Stripe. Crie uma chave restrita somente com acesso de leitura.",
  "error.crm.sourceInvalidKey": "O Stripe não aceita esta chave. Copie a chave restrita de novo.",
  "error.crm.sourcePermission":
    "Esta chave não consegue ler clientes, faturas, assinaturas, eventos e produtos. Dê a ela acesso de leitura a eles.",
  "error.crm.sourceRateLimited": "O Stripe recebeu solicitações demais. Tente de novo em um minuto.",
  "error.crm.sourceNetwork": "O OpenBot não consegue se conectar ao Stripe. Verifique a conexão com a internet.",
  "error.crm.sourceFailed": "O Stripe enviou uma resposta que o OpenBot não consegue ler. Tente de novo mais tarde.",
  "error.crm.sourceKeySaveFailed": "O OpenBot não consegue salvar a chave do Stripe neste computador.",
  "error.crm.off":
    "O CRM está desativado. Um proprietário ou administrador pode ativá-lo em Configurações do servidor > Experimental.",
  "error.crm.settingsSaveFailed": "O OpenBot não consegue salvar a configuração do CRM neste servidor.",
} as const satisfies PartialTranslation<typeof source>;
