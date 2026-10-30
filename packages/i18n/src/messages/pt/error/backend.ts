import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/backend";

export const messages = {
  "error.backend.eventsUnavailable": "Os eventos não estão disponíveis neste computador anfitrião.",
  "error.backend.databaseIntegrity": "O banco de dados do OpenBot falhou na verificação de integridade.",
  "error.backend.webhookRouteLimit": "Um computador anfitrião pode ter no máximo {limit} rotinas de webhook.",
  "error.backend.webhookSettingsInvalid": "Verifique as configurações do webhook e tente de novo.",
  "error.backend.webhookRouteUnavailable":
    "A rota pública do webhook não está pronta. Verifique a conexão do computador anfitrião e tente de novo.",
  "error.backend.browserViewRemoteOnly":
    "A visualização ao vivo do navegador só está disponível para um computador anfitrião remoto.",
  "error.backend.browserViewUnsupported":
    "Este computador anfitrião remoto não oferece suporte à visualização ao vivo do navegador.",
  "error.backend.browserViewLimit": "Há visualizações do navegador demais abertas neste computador anfitrião.",
  "error.backend.browserViewEnded": "A visualização ao vivo desta página terminou.",
  "error.backend.browserViewFailed": "A visualização ao vivo desta página falhou.",
  "error.backend.windowTemporarilyUnavailable": "A janela do OpenBot está temporariamente indisponível.",
  "error.backend.windowUnavailable": "A janela do OpenBot está indisponível.",
  "error.backend.sunshineApiHttp": "A API do Sunshine falhou com HTTP {status}.",
  "error.backend.sunshinePortsUnavailable":
    "Não foi possível reservar um conjunto de portas livres do Sunshine para a área de trabalho remota.",
  "error.backend.moonlightPortsUnavailable":
    "Não foi possível reservar uma faixa de portas livres do Moonlight WebRTC para a área de trabalho remota.",
  "error.backend.iceServerNoPort": "O servidor ICE da área de trabalho remota não recebeu uma porta.",
  "error.backend.remoteDesktopStoppedWhileStarting":
    "O ambiente de execução da área de trabalho remota foi interrompido durante a inicialização.",
  "error.backend.sunshineNotStarted": "O Sunshine não iniciou em um conjunto de portas reservadas.",
  "error.backend.moonlightNoHost": "O Moonlight não tem um computador anfitrião local pareado.",
  "error.backend.sunshineNoDesktop": "O Sunshine não publicou o aplicativo Desktop.",
  "error.backend.sunshineAmbiguousPairing": "O Sunshine retornou solicitações ambíguas de pareamento local.",
  "error.backend.sunshineNoPairingRequest": "O Sunshine não recebeu a solicitação esperada de pareamento local.",
  "error.backend.moonlightPairingHttp": "O pareamento do Moonlight falhou com HTTP {status}.",
  "error.backend.moonlightRejectedPairing": "O Moonlight rejeitou o pareamento com o Sunshine.",
  "error.backend.moonlightNoPin": "O Moonlight não retornou um PIN de pareamento.",
  "error.backend.moonlightPairingIncomplete": "O pareamento do Moonlight não foi concluído.",
  "error.backend.moonlightWebNotEmbedded": "O Moonlight Web não é uma versão integrada ao OpenBot.",
  "error.backend.moonlightEmptyResponse": "O Moonlight retornou uma resposta vazia.",
  "error.backend.remoteDesktopTimeout": "O tempo da solicitação de área de trabalho remota esgotou.",
  "error.backend.moonlightApiHttp": "A API do Moonlight falhou com HTTP {status}.",
  "error.backend.sunshineExited": "O Sunshine encerrou antes de sua API HTTPS na porta {port} ficar pronta.",
  "error.backend.sunshineNoAnswer": "O Sunshine não respondeu.",
  "error.backend.sunshineTlsUnexpected": "O Sunshine retornou um certificado TLS inesperado.",
  "error.backend.moonlightWebExited": "O Moonlight Web encerrou antes de {url} ficar pronto.",
  "error.backend.moonlightWebNotReady": "O Moonlight Web não ficou pronto.",
  "error.backend.channelDeleteUnsupported": "Este servidor não oferece suporte à exclusão de canais.",
  "error.backend.browserNavigateUnsupported":
    "Este computador anfitrião remoto não oferece suporte à navegação pela barra de endereços em uma aba existente.",
  "error.backend.browserUserControlBusy":
    "Esta aba do navegador está esperando um segredo. Responda primeiro ao pedido do segredo.",
  "error.backend.browserUserControlUnsupported":
    "Este computador anfitrião remoto não oferece suporte para assumir o controle de uma aba do navegador.",
  "error.backend.browserSignInUnsupported": "Este host remoto não pode receber um início de sessão deste computador.",
  "error.backend.browserSignInOpenFailed": "O OpenBot não conseguiu abrir a janela de login.",
  "error.backend.browserSignInReadFailed": "O OpenBot não conseguiu ler o login da janela.",
  "error.backend.browserStopUnsupported":
    "Este computador anfitrião remoto não consegue parar o carregamento de uma página.",
  "error.backend.sharedDataLocalOnly":
    "Os dados compartilhados são gerenciados no computador que executa estes agentes.",
  "error.backend.browserUrlProtocol": "Somente URLs HTTP(S) são permitidas no navegador.",
  "error.backend.sunshineNotReady": "O Sunshine não ficou pronto.",
  "error.backend.sunshineNotReadyReason": "O Sunshine não ficou pronto. {reason}",
  "error.backend.channelLeadModelUnavailable": "O modelo do líder do canal está indisponível.",
  "error.backend.sharedDataUnavailable": "Os dados compartilhados estão indisponíveis.",
  "error.backend.shuttingDown": "O OpenBot está encerrando.",
  "error.backend.channelUnconfirmedStart":
    "O canal tem uma tarefa atribuída cujo início não foi confirmado. Verifique o resultado antes de excluí-lo.",
  "error.backend.channelNotFound": "Canal não encontrado.",
  "error.backend.channelMemberUnavailable": "Um membro do canal está indisponível.",
  "error.backend.channelArchived": "Restaure este canal antes de enviar mensagens ou alterar tarefas.",
  "error.backend.channelReferenceUnavailable": "A mensagem do canal usada como referência está indisponível.",
  "error.backend.channelTaskNotFound": "Tarefa do canal não encontrada.",
  "error.backend.channelTaskComplete": "Esta tarefa já está concluída.",
  "error.backend.channelSelectAgent": "Selecione um agente.",
  "error.backend.channelLeadRequired": "Escolha um líder de canal disponível ou atribua esta tarefa a um membro.",
  "error.backend.channelRoutingTooLong":
    "Esta solicitação excede o limite de contexto de encaminhamento. Selecione um membro ou envie uma solicitação mais curta.",
  "error.backend.channelTaskMemberRequired": "Escolha um membro para esta tarefa.",
  "error.backend.channelTaskStopped": "Parada. Continue ou reatribua esta tarefa.",
  "error.backend.channelRoutingUnreadable": "O líder não conseguiu encaminhar esta mensagem. Reatribua-a a um membro.",
  "error.backend.channelRoutingFailed": "O encaminhamento falhou. Escolha um membro ou tente novamente.",
  "error.backend.channelLeadTimedOut": "O líder do canal não respondeu a tempo. Escolha um membro ou tente novamente.",
  "error.backend.channelLeadFailed":
    "O líder do canal não conseguiu encaminhar esta mensagem. Escolha um membro ou tente novamente.",
  "error.backend.channelRequestMemberRequired": "Escolha um membro para esta solicitação.",
  "error.backend.channelDeliveryNotCreated": "A entrega do canal não foi criada.",
  "error.backend.channelAssignmentStopped": "Esta tarefa atribuída pelo canal foi interrompida ou substituída.",
  "error.backend.channelAssigneeUnavailable": "O agente responsável está indisponível.",
  "error.backend.channelAssigneeRemoved": "O membro responsável foi removido.",
  "error.backend.channelAssigneeReassign": "O membro responsável está indisponível. Reatribua esta tarefa.",
  "error.backend.channelAssignmentChanged": "Esta tarefa atribuída pelo canal mudou.",
  "error.backend.channelMemberRequired": "Selecione um membro disponível deste canal.",
  "error.backend.memoryEssentialBudget":
    "As memórias essenciais excedem o limite do prompt. Marque uma entrada para pesquisar quando necessário e tente de novo.",
  "error.backend.memorySelectionConflict": "A memória mudou. Recarregue-a e tente de novo.",
  "error.backend.memorySelectionUserControlled":
    "O usuário controla esta seleção de memória. Mantenha a escolha do usuário.",
  "error.backend.memorySearchQuery": "Digite uma ou mais palavras de busca, até 256 caracteres.",
  "error.backend.memoryOperationFailed": "A operação de memória falhou. Tente de novo.",
  "error.backend.memoryGone": "Esta memória não existe mais.",
  "error.backend.routineGone": "Esta rotina não existe mais.",
  "error.backend.turnNotStarted": "O provedor não iniciou este turno.",
  "error.backend.routineResultConnectionOff":
    "Esta conexão de mensagens está desativada ou foi removida. Escolha outro lugar.",
  "error.backend.routineResultNoDelivery": "Esta execução não tem uma resposta para enviar de novo.",
  "error.backend.channelMemoryLimit": "Um canal pode ter até {limit} memórias.",
  "error.backend.channelRoutineLimit": "Um canal pode ter no máximo {limit} rotinas.",
  "error.backend.agentRoutineLimit": "Um agente pode ter no máximo {limit} rotinas.",
  "error.backend.agentMemoryLimit": "Um agente pode ter até {limit} memórias.",
  "error.backend.agentMemoryLimitReached":
    "Você tem {saved} de {limit} memórias. Para abrir espaço, atualize uma memória pelo memoryId com o texto combinado de duas memórias relacionadas e esqueça a outra, ou esqueça uma memória que não é mais verdadeira. Depois tente de novo.",
  "error.backend.agentMemoryLimitExceeded":
    "Você tem {saved} memórias, e o limite é {limit}. O usuário definiu o limite abaixo do número de memórias salvas. Não esqueça memórias para abrir espaço. Diga ao usuário que esta memória não foi salva.",
  "error.backend.channelHistoryLeadRequired": "Escolha um líder de canal para preparar o histórico compartilhado.",
  "error.backend.channelHistoryArriving":
    "Uma mensagem compartilhada ainda está chegando. Retome quando ela estiver completa.",
  "error.backend.channelHistoryInvalid": "O resumo do histórico é inválido. Retome para tentar novamente.",
  "error.backend.channelContextTooLong":
    "Esta tarefa atribuída excede o limite de contexto compartilhado. Envie uma solicitação mais curta ou atribua a tarefa novamente.",
  "error.backend.draftAttachmentLimit": "Mantenha no máximo {limit} anexos de rascunho.",
  "error.backend.recipientRequired": "É necessário informar pelo menos um destinatário.",
  "error.backend.recipientLimit": "Uma mensagem pode ter no máximo {limit} destinatários.",
  "error.backend.attachmentDraftGone": "O rascunho de anexo não existe mais: {id}",
  "error.backend.attachmentInQueueEdit": "Um anexo pertence a uma edição da fila.",
  "error.backend.messageEmpty": "A mensagem não pode estar vazia.",
  "error.backend.attachLimit": "Anexe no máximo {limit} arquivos.",
  "error.backend.queuedMessageNotFound": "A mensagem na fila não foi encontrada.",
  "error.backend.cancelQueuedOnly": "Somente mensagens na fila podem ser canceladas.",
  "error.backend.messageBeingEdited": "Esta mensagem está sendo editada. Salve ou cancele a edição primeiro.",
  "error.backend.queuedMessageUnavailable": "Esta mensagem na fila não está mais disponível.",
  "error.backend.editedOnOtherDevice": "Esta mensagem está sendo editada em outro dispositivo.",
  "error.backend.editUnavailable": "Esta edição não está mais disponível.",
  "error.backend.attachmentInOtherEdit": "Um anexo pertence a outra edição.",
  "error.backend.messageBeingSaved": "Esta mensagem está sendo salva. Tente novamente quando terminar.",
  "error.backend.editQueuedOnly": "Somente mensagens na fila podem ser editadas.",
  "error.backend.attachmentNotInMessage": "Um anexo não pertence à mensagem na fila.",
  "error.backend.queueOrderStale": "A ordem da fila está desatualizada. Atualize a fila e tente novamente.",
  "error.backend.fileGone": "O arquivo não existe ou já foi excluído.",
  "error.backend.managedAttachmentChanged": "O anexo gerenciado não foi encontrado ou mudou: {name}",
  "error.backend.mailboxStateCorrupt":
    "O estado da caixa de mensagens está corrompido ou é de uma versão mais recente do OpenBot; ele não será sobrescrito.",
  "error.backend.recipientDeleting": "O destinatário está sendo excluído. Tente novamente quando a exclusão terminar.",
  "error.backend.recipientHidden": "Este agente está oculto. Restaure-o para enviar mensagens.",
  "error.backend.attachBetween": "Anexe de 1 a {limit} arquivos.",
  "error.backend.attachmentNotFile": "O anexo não é um arquivo: {path}",
  "error.backend.generatedImageTooLarge": "A imagem gerada excede o limite de 100 MB.",
  "error.backend.attachmentNotRegularFile": "Somente arquivos comuns podem ser anexados: {name}",
  "error.backend.attachmentCopyFailed": "O OpenBot não conseguiu copiar {name}.",
  "error.backend.routineNameRequired": "É necessário informar um nome para a rotina.",
  "error.backend.routineNameTooLong": "O nome da rotina é muito longo.",
  "error.backend.routineInstructionRequired": "É necessário informar uma instrução para a rotina.",
  "error.backend.routineInstructionTooLong": "A instrução da rotina é muito longa.",
  "error.backend.routineScheduleInvalid": "O agendamento da rotina é inválido.",
  "error.backend.routineIntervalTooShort":
    "Os intervalos das rotinas devem ser de pelo menos {minutes} minutos. Use {minutes} minutos ou mais, ou um agendamento diário, semanal ou cron.",
  "error.backend.routineIntervalTooShortFixed":
    "Os intervalos das rotinas devem ser de pelo menos {minutes} minutos. Use {minutes} minutos ou mais, ou um horário fixo.",
  "error.backend.routineCronTooOften":
    "Os agendamentos personalizados devem ter um intervalo de pelo menos {minutes} minutos entre execuções.",
  "error.backend.routineAnchorInvalid": "O ponto de referência do intervalo da rotina é inválido.",
  "error.backend.routineNoOccurrence": "O agendamento não tem nenhuma ocorrência nos próximos cinco anos.",
  "error.backend.routineOncePassed": "O horário desta rotina única já passou. Escolha uma data ou hora posterior.",
  "error.backend.routineTimezoneInvalid": "O fuso horário da rotina é inválido.",
  "error.backend.routineCronFields": "Os agendamentos personalizados devem usar cinco campos cron.",
  "error.backend.routineCronValueInvalid": "O valor do campo cron {field} é inválido.",
  "error.backend.routineCronFieldEmpty": "O campo cron {field} está vazio.",
  "error.backend.routineDeletionBusy": "Outra exclusão de rotina já está em andamento para este agente.",
  "error.backend.routineWaitForAgent": "Aguarde a operação do agente terminar antes de executar uma rotina.",
  "error.backend.routineRunStarting":
    "Esta execução da rotina ainda está iniciando. Tente novamente após o início do turno.",
  "error.backend.routineRunNoSession":
    "O OpenBot não pode interromper a execução ativa da rotina porque a sessão do provedor está indisponível.",
  "error.backend.interruptSelf": "Um agente não pode interromper a si mesmo.",
  "error.backend.interruptOtherWork":
    "Este agente trabalha em uma tarefa que sua mensagem não iniciou. Somente o usuário ou quem enviou a tarefa pode interrompê-lo.",
  "error.backend.interruptStarting":
    "Este agente ainda está iniciando um turno. Tente novamente após o início do turno.",
  "error.backend.interruptNoSession":
    "O OpenBot não pode interromper este agente porque a sessão do provedor está indisponível.",
  "error.backend.memoryTextRequired": "É necessário informar o texto da memória.",
  "error.backend.memoryTextTooLong": "O texto da memória é muito longo.",
  "error.backend.mcpServerGone": "Este servidor MCP não existe mais.",
  "error.backend.routineFlowLinkGone": "Esta conexão não existe mais.",
  "error.backend.routineFlowSameAgent": "Um agente não pode passar trabalho para si mesmo.",
  "error.backend.routineFlowIntoOwner":
    "A rotina começa com o próprio agente, então esse agente não pode receber trabalho de outro.",
  "error.backend.routineFlowNotOnPath": "Este agente ainda não faz parte da rotina. Conecte-o à rotina primeiro.",
  "error.backend.routineFlowDuplicate": "Estes agentes já estão conectados nesta rotina.",
  "error.backend.routineFlowCycle": "Esta conexão criaria um loop.",
  "error.backend.routineFlowLinkLimit": "Uma rotina pode ter no máximo {limit} conexões.",
  "error.backend.agentWaitLimit":
    "Este agente já tem {count} esperas abertas. Feche uma espera com openbot.close_wait antes de abrir outra.",
  "error.backend.agentWaitGone": "Esta espera não está aberta. O agente a fechou ou alguém a cancelou.",
  "error.backend.agentWaitNoRequest": "Uma espera precisa de uma mensagem para continuar. Este turno não tem mensagem.",
  "error.backend.agentWaitOwnChatOnly":
    "Abra uma espera apenas no seu próprio chat. Uma tarefa de canal ou de mensagens não pode esperar.",
  "error.backend.agentWaitNoteRequired": "Escreva uma nota curta que diga para que serve a espera.",
  "error.backend.agentWaitRoutineGone": "Este agente não tem nenhuma rotina com este id.",
  "error.backend.agentWaitNoRoutine":
    "Somente uma execução de uma das suas rotinas desperta uma espera, e você não tem nenhuma rotina. Crie uma com openbot.create_routine e depois abra a espera.",
  "error.backend.agentWaitRemoteUnsupported": "As esperas abertas só estão disponíveis para agentes neste computador.",
  "error.backend.routineFlowHandoffFailed": "A rotina não conseguiu passar o trabalho para este agente.",
  "error.backend.mcpServerLimit": "O OpenBot mantém até {limit} servidores MCP.",
  "error.backend.mcpServerNameTaken": "Já existe um servidor MCP chamado {name}.",
  "error.backend.mcpServerInvalid": "O OpenBot não pode salvar esta configuração de servidor MCP.",
  "error.backend.mcpServerNoAnswer": "O servidor não respondeu em {seconds} segundos.",
  "error.backend.mcpSignInNotAccepted": "O servidor não aceitou esse login.",
  "error.backend.mcpSignInClientRefused":
    "O servidor de login não aceitou o OpenBot ao concluir o login. Entre de novo: o OpenBot se registra outra vez no servidor.",
  "error.backend.mcpCommandNotFound": "Comando não encontrado: {command}",
  "error.backend.mcpRegistrationRefused":
    "O servidor de login ainda não aceita o OpenBot como aplicativo. Sua conta não é a causa. Use outra forma de conexão, como um servidor MCP local.",
  "error.backend.mcpSignInAbandonedGeneric": "O login foi abandonado.",
  "error.backend.mcpSignInForgotten": "O login MCP foi esquecido enquanto estava em andamento.",
  "error.backend.mcpSignInAbandoned": "O login MCP foi abandonado.",
  "error.backend.mcpSignInNoBrowser": "Este login MCP não consegue abrir um navegador.",
  "error.backend.mcpSignInNotWebPage": "O endereço de login não é uma página da web.",
  "error.backend.mcpSignInRequired":
    "Este servidor pede que você se autentique. Escolha Entrar para continuar no navegador.",
  "error.backend.mcpSignInOnHost": "Este servidor pede login. Entre nele pelo OpenBot no computador anfitrião.",
  "error.backend.mcpSignInNeedsHttps":
    "Este servidor pede login, e o OpenBot só faz login por https. Altere a URL para {url}.",
  "error.backend.mcpSignInCancelled": "O login foi cancelado.",
  "error.backend.mcpSignInTimedOut": "O login não foi concluído no navegador.",
  "error.backend.mcpSignInResponseTimedOut": "A resposta do login não chegou a tempo.",
  "error.backend.mcpSignInMetadataUnreadable":
    "O OpenBot não conseguiu ler as informações de login deste servidor. Verifique o endereço do servidor e tente novamente.",
  "error.backend.mcpServerExited":
    "O servidor parou antes de responder. Execute o comando em um terminal para ver o erro.",
  "error.backend.mcpServerFailedToStart": "O servidor não iniciou: {reason}",
  "error.backend.mcpOAuthProxyUnavailable":
    "O OpenBot não conseguiu iniciar a conexão local de login para este servidor. Reinicie o OpenBot e tente novamente.",
  "error.backend.mcpOAuthSignInNeeded":
    "O login neste servidor MCP terminou. O usuário precisa entrar novamente no OpenBot.",
  "error.backend.mcpServerUnreachable": "O OpenBot não conseguiu acessar o servidor. Verifique a URL e sua rede.",
  "error.backend.mcpLocalServerOff":
    "Nenhum servidor responde em {address} neste computador. Inicie o servidor ou ative-o no app que o executa e tente novamente.",
  "error.backend.mcpServerBlocked":
    "Este computador bloqueou a conexão com o servidor. Verifique seu firewall ou software de segurança e tente novamente.",
  "error.backend.mcpServerIncompatible":
    "Algo respondeu neste endereço, mas não como um servidor MCP por Streamable HTTP. Verifique a URL e atualize o app que executa o servidor.",
  "error.backend.mcpRemoteBridge":
    "{reason} Este comando executa a ponte mcp-remote. Escolha Streamable HTTP com a URL {url} e o OpenBot faz o login para você.",
  "error.backend.oauthNotHttps": "O endpoint OAuth {origin} não usa https, por isso as credenciais não foram enviadas.",
  "error.backend.oauthTooManyRedirects": "O endpoint OAuth redirecionou vezes demais.",
  "error.backend.oauthRedirectOrigin":
    "O endpoint OAuth redirecionou para {origin}, por isso as credenciais não foram encaminhadas.",
  "error.backend.oauthTimedOut": "O endpoint OAuth {origin} não respondeu a tempo.",
  "error.backend.oauthResponseTooLarge": "O endpoint OAuth {origin} enviou uma resposta grande demais.",
  "error.backend.oauthResponseUnreadable": "Não foi possível ler a resposta do endpoint OAuth {origin}.",
  "error.backend.mcpOAuthPrivateEndpoint":
    "O endpoint OAuth {origin} está em uma rede privada, mas o servidor MCP é público, por isso as credenciais não foram enviadas.",
  "error.backend.sidebarSectionLimit": "Um servidor pode ter até {limit} seções na barra lateral.",
  "error.backend.sectionNameRequired": "É necessário informar o nome da seção.",
  "error.backend.sectionNameTooLong": "O nome da seção é muito longo.",
  "error.backend.sectionNameDuplicate": "Os nomes das seções devem ser exclusivos.",
  "error.backend.directMessageRequired": "Escreva uma mensagem primeiro.",
  "error.backend.directMessageTooLong": "Uma mensagem direta pode ter até {limit} caracteres.",
  "error.backend.directMessageSelf": "Você não pode enviar uma mensagem direta para si mesmo.",
  "error.backend.readBoundaryUnavailable": "O limite de leitura não está mais disponível.",
  "error.backend.sharedFileOutside": "O arquivo compartilhado deve estar dentro do diretório compartilhado.",
  "error.backend.sharedPathIsFolder": "O caminho compartilhado é uma pasta, não um arquivo.",
  "error.backend.sharedPathNotFile": "O caminho compartilhado não é um arquivo.",
  "error.backend.workspaceFileOutside":
    "O arquivo do espaço de trabalho deve estar dentro do espaço de trabalho do agente.",
  "error.backend.workspacePathNotFile": "O caminho do espaço de trabalho não é um arquivo.",
  "error.backend.workspacePathNotDirectory": "O caminho do espaço de trabalho não é uma pasta.",
  "error.backend.workspacePathMissing": "Nada existe em {path} no espaço de trabalho do agente {root}.",
  "error.backend.workspacePathMissingForMember": "Nada existe em {path} no espaço de trabalho do agente.",
  "error.backend.useChannelTaskControls": "Use os controles de tarefas do canal para esta tarefa atribuída.",
  "error.backend.editFinished": "Esta edição já terminou.",
  "error.backend.editCancelled": "Esta edição foi cancelada, por isso a mensagem mantém o texto original.",
  "error.backend.editSaved": "Esta edição já foi salva.",
  "error.backend.editSavedDifferent": "Esta edição já foi salva com outro conteúdo. Suas alterações não foram salvas.",
  "error.backend.useChannelTaskControlsWork": "Use os controles de tarefas do canal para o trabalho no canal.",
  "error.backend.steerTurnChanged": "O turno ativo mudou antes que esta mensagem pudesse orientá-lo.",
  "error.backend.steerUnsupported": "Este provedor não pode orientar um turno em execução. Sua mensagem fica na fila.",
  "error.backend.steerRoutineRun": "Uma rotina está em execução. Sua mensagem fica na fila e começa depois da rotina.",
  "error.backend.steerQueuedOnly": "Somente mensagens na fila podem orientar o turno ativo.",
  "error.backend.promptInactive": "Esta pergunta não está mais ativa.",
  "error.backend.promptAnswerMismatch": "Uma resposta não corresponde a uma pergunta ativa.",
  "error.backend.approvalInactive": "Esta aprovação não está mais ativa.",
  "error.backend.takeoverInactive": "Este controle manual do navegador não está mais ativo.",
  "error.backend.authSubmitting": "O envio da autenticação já está em andamento.",
  "error.backend.apiKeySaveFailed": "O OpenBot não conseguiu salvar a chave de API. Tente novamente.",
  "error.backend.apiKeyNotAllowed":
    "Somente o proprietário do servidor ou um administrador pode inserir uma chave de API.",
  "error.backend.apiKeySaving": "A chave de API já está sendo salva.",
  "error.backend.authRequestInactive": "Esta solicitação de autenticação segura não está mais ativa.",
  "error.backend.secureAuthUnavailable": "A autenticação segura está indisponível.",
  "error.backend.browserUrlRequired": "É necessário informar uma URL para o navegador.",
  "error.backend.browserUrlTooLong": "A URL do navegador é muito longa.",
  "error.backend.browserTabLimit": "O navegador pode ter até {limit} abas abertas.",
  "error.backend.browserProfileMissing":
    "O perfil de navegador deste agente não existe mais. Escolha outro perfil nas configurações do agente.",
  "error.backend.browserProfileNotFound": "Este perfil de navegador não existe mais.",
  "error.backend.browserProfileNameTaken": "Já existe um perfil de navegador com este nome.",
  "error.backend.browserSessionInUse": "Uma aba ainda usa esta sessão do navegador. Tente novamente.",
  "error.backend.browserProfileLimit": "Você pode ter até {limit} perfis de navegador.",
  "error.backend.browserLowMemory":
    "Este servidor está com pouca memória, por isso o navegador não pode abrir outra aba. Feche uma aba ou aguarde os outros agentes terminarem.",
  "error.backend.browserOpenFailed": "Não foi possível abrir {url}: {reason}",
  "error.backend.popupSecureInput":
    "Pop-ups são bloqueados durante a entrada segura. Conclua ou cancele a entrada segura e tente novamente na página.",
  "error.backend.popupUnsupportedType":
    "Este tipo de pop-up não é compatível. Use um link normal ou um botão de login na página.",
  "error.backend.popupUnsupportedAddress":
    "Este pop-up usa um endereço incompatível. Use uma opção de login HTTP ou HTTPS na página.",
  "error.backend.popupTabLimit":
    "O limite de abas do navegador foi atingido. Feche uma aba e tente novamente na página.",
  "error.backend.popupLoadFailed": "Não foi possível carregar o pop-up. Tente entrar novamente pela página original.",
  "error.backend.browserTabNotFound": "Aba do navegador não encontrada.",
  "error.backend.authActive": "A autenticação já está ativa.",
  "error.backend.authHttpsRequired": "A autenticação segura exige HTTPS.",
  "error.backend.authDigitsRange": "Os códigos de autenticação exigem de 4 a 12 dígitos.",
  "error.backend.authExpired": "A solicitação de autenticação expirou.",
  "error.backend.authDigitsRequired": "Digite a quantidade de dígitos solicitada.",
  "error.backend.browserViewProtected": "A visualização do navegador está protegida durante a autenticação.",
  "error.backend.browserPreviewPageChanged": "A página do navegador mudou durante a prévia. Tente novamente.",
  "error.backend.browserInputProtected": "A entrada de dados no navegador está protegida durante a autenticação.",
  "error.backend.mcpServerHttpCredentials":
    "O servidor respondeu com {status}. Verifique a chave de API ou outras credenciais.",
  "error.backend.mcpServerHttpUrl":
    "O servidor respondeu com {status}. Verifique a URL. O link pode estar incorreto, expirado ou excluído.",
  "error.backend.mcpSignInAppUrl": "O app de login precisa de uma URL de servidor válida.",
  "error.backend.mcpSignInAppClientId": "Digite o ID do cliente do app de login.",
  "error.backend.mcpSignInAppIssuerChanged":
    "O servidor de login deste servidor MCP mudou, então o OpenBot não enviou o app de login a ele. Se a mudança estiver correta, remova o app de login e adicione-o de novo.",
  "error.backend.mcpSignInAppNoServer":
    "Salve este servidor MCP como servidor de URL antes de adicionar um app de login.",
  "error.backend.mcpSignInAppUnavailable": "Este computador não consegue guardar um app de login.",
  "error.backend.taskMoveRefused":
    "Só uma mensagem que você enviou apenas para este agente pode ser executada como tarefa.",
  "error.backend.taskNotFound": "Esta tarefa não está disponível.",
  "error.backend.taskClosed": "Esta tarefa está fechada. Abra-a de novo para enviar uma mensagem.",
  "error.backend.taskStillRunning": "Esta tarefa ainda está em execução. Aguarde até ela parar e depois feche-a.",
  "error.backend.threadNotFound": "Este tópico não está disponível.",
  "error.backend.threadStillRunning": "Este tópico ainda está em execução. Interrompa-o e tente de novo.",
  "error.backend.threadArchived": "Este tópico está arquivado. Restaure-o para enviar uma mensagem.",
  "error.backend.threadTitleRequired": "Dê um título curto ao tópico.",
  "error.backend.threadOpenLimitReached":
    "Este agente tem {count} tópicos abertos. Arquive um tópico e depois inicie ou restaure outro.",
  "error.backend.threadRemoteUnsupported": "Os tópicos só estão disponíveis para agentes neste computador.",
  "error.backend.threadMoveRefused":
    "Só uma mensagem que você enviou apenas para este agente pode ser executada em um novo tópico.",
  "error.backend.taskTitleRequired": "Dê um título curto à tarefa.",
  "error.backend.taskToolInvalid":
    "Dê à tarefa um título de no máximo 120 caracteres e uma instrução que diga o que fazer.",
  "error.backend.taskOwnChatOnly":
    "Inicie uma tarefa só a partir do seu próprio chat. Um canal, uma conversa de mensagens ou outra tarefa não pode iniciar uma.",
  "error.backend.taskOpenLimit":
    "Este agente já tem {count} tarefas abertas. Aguarde até o usuário fechar uma antes de iniciar outra tarefa.",
  "error.backend.taskOpenLimitReached":
    "Este agente tem {count} tarefas abertas. Feche uma tarefa e depois inicie ou abra outra.",
  "error.backend.taskRemoteUnsupported": "As tarefas só estão disponíveis para agentes neste computador.",
  "error.backend.taskStartFailed": "O OpenBot não conseguiu iniciar a tarefa. Faça o trabalho neste turno.",
} as const satisfies PartialTranslation<typeof source>;
