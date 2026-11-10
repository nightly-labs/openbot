import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/connector";

export const messages = {
  // Marketplace > Apps > GitHub: the built-in GitHub connection.
  "connector.github.title": "GitHub",
  "connector.github.description":
    "Mọi trợ lý trên máy tính này đều có thể dùng các kho mã, issue và pull request của GitHub, cùng gh và git.",
  "connector.github.connect": "Kết nối GitHub",
  "connector.github.pendingTitle": "Nhập mã này trên GitHub",
  "connector.github.pendingDescription": "GitHub đã mở trong trình duyệt của bạn. Nhập mã ở đó để kết nối.",
  "connector.github.waiting": "Đang chờ GitHub",
  "connector.github.copyCode": "Sao chép mã",
  "connector.github.codeCopied": "Đã sao chép",
  "connector.github.openGitHub": "Mở GitHub",
  "connector.github.cancel": "Hủy",
  "connector.github.connectedAs": "Đã kết nối với @{login}",
  "connector.github.repositoriesTitle": "Kho mã",
  "connector.github.repositoriesDescription":
    "Trợ lý chỉ có thể dùng các kho mã nơi OpenBot GitHub App đã được cài đặt.",
  "connector.github.chooseRepositories": "Chọn kho mã",
  "connector.github.repositoriesLoading": "Đang đọc các kho mã từ GitHub",
  "connector.github.repositoriesFailed": "OpenBot không thể đọc các kho mã từ GitHub.",
  "connector.github.noRepositories": "OpenBot GitHub App chưa được cài đặt trên kho mã nào.",
  // {count} is a number, such as 12.
  "connector.github.moreRepositories": { other: "Và {count} kho mã khác" },
  // A badge next to a repository that only its members can see.
  "connector.github.private": "Riêng tư",
  "connector.github.disconnect": "Ngắt kết nối",
  "connector.github.disconnectTitle": "Ngắt kết nối GitHub",
  "connector.github.disconnectSummary": "Mọi trợ lý sẽ mất GitHub. Trò chuyện và tệp của bạn vẫn còn.",
  "connector.github.expiredTitle": "Kết nối GitHub đã hết hạn",
  "connector.github.expiredDescription": "Kết nối lại với @{login} để cấp lại GitHub cho các trợ lý.",
  "connector.github.reconnect": "Kết nối lại",
  "connector.github.actionFailed": "OpenBot không thể thay đổi kết nối GitHub.",
  // The status next to the name at the top of the GitHub page.
  "connector.github.statusConnected": "Đã kết nối",
  "connector.github.statusConnecting": "Đang kết nối",
  "connector.github.statusExpired": "Đã hết hạn",
  "connector.github.accountTitle": "Tài khoản",
  // {count} is the number of repositories in the list, such as 12.
  "connector.github.filterPlaceholder": { other: "Lọc {count} kho mã" },
  "connector.github.filterLabel": "Lọc kho mã",
  // {query} is the text the user typed in the filter.
  "connector.github.noMatch": "Không có kho mã nào khớp với “{query}”.",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.github.stepSignIn": "Đăng nhập",
  "connector.github.stepConnected": "Đã kết nối",
  "connector.github.requestingCode": "OpenBot yêu cầu GitHub cấp mã.",
  // {code} is the code to type on GitHub, such as WDJB-MJHT.
  "connector.github.codeLabel": "Mã {code}",
  "connector.github.failedTitle": "GitHub không kết nối được",
  "connector.github.cancelConnecting": "Hủy kết nối GitHub",
  // {count} is the number of repositories that agents can use.
  "connector.github.connectedSummary": {
    other: "{count} kho mã · mọi trợ lý trên máy tính này",
  },
  "connector.github.done": "Xong",
  "connector.github.later": "Để sau",
  // The confirmation before Disconnect. {login} is the GitHub account name, such as octocat.
  "connector.github.disconnectConfirmTitle": "Ngắt kết nối GitHub?",
  "connector.github.disconnectConfirmDescription": "Ngắt kết nối sẽ xóa đăng nhập của @{login} khỏi máy tính này.",
  "connector.github.disconnectEffectTools": "Mọi trợ lý sẽ mất các công cụ GitHub, gh và git.",
  "connector.github.disconnectEffectRevoke": "Sau đó GitHub mở, nơi bạn có thể thu hồi quyền của OpenBot.",
  "connector.github.disconnectEffectKept": "Trò chuyện, tệp và trí nhớ trợ lý vẫn ở trên máy tính này.",
  // The same text for the connection of a joined server. {host} is the server name, such as Studio.
  "connector.github.descriptionHost":
    "Mọi trợ lý trên {host} đều có thể dùng các kho mã, issue và pull request của GitHub, cùng gh và git.",
  "connector.github.connectedSummaryHost": {
    other: "{count} kho mã · mọi trợ lý trên {host}",
  },
  "connector.github.disconnectConfirmDescriptionHost": "Ngắt kết nối sẽ xóa đăng nhập của @{login} khỏi {host}.",
  "connector.github.disconnectEffectKeptHost": "Trò chuyện, tệp và trí nhớ trợ lý vẫn ở trên {host}.",
  "connector.github.keepConnected": "Giữ kết nối",
  "connector.github.close": "Đóng",
  // The last section of an integration page, with the action that removes it.
  "connector.dangerZone": "Khu vực nguy hiểm",
  "connector.statusUnknown": "Không xác định",
  "connector.readFailed": "OpenBot không thể đọc trạng thái của kết nối này.",

  // Marketplace > Apps > Slack: a workspace installs the one OpenBot app, and the Slack
  // Orchestrator agent receives each request, asks the team and answers.
  "connector.slack.title": "Slack",
  "connector.slack.description":
    "Mọi người nhắc @OpenBot trong Slack hoặc gửi cho nó tin nhắn trực tiếp. Slack Orchestrator hỏi trợ lý phù hợp và trả lời.",
  "connector.slack.statusConnected": "Đã kết nối",
  "connector.slack.statusAttention": "Cần xem xét",
  // {workspace} is the Slack workspace name.
  "connector.slack.summaryConnected": "{workspace} · Slack Orchestrator trả lời",
  "connector.slack.summaryNoAgent": "{workspace} · Chưa có trợ lý nào trả lời",
  "connector.slack.attentionTitle": {
    other: "{count} không gian làm việc cần xem xét",
  },
  "connector.slack.attentionDescription": "Trạng thái bên dưới cho biết cần làm gì.",
  "connector.slack.connect": "Kết nối Slack",
  "connector.slack.addAgent": "Thêm trợ lý",
  "connector.slack.actionFailed": "Slack không chấp nhận thay đổi",
  "connector.slack.workspaceTitle": "Không gian làm việc",
  "connector.slack.workspaceDescription": "Mọi người nhắc @OpenBot hoặc gửi cho nó tin nhắn trực tiếp.",
  "connector.slack.disconnectWorkspace": "Ngắt kết nối",
  "connector.slack.disconnectAllTitle": "Ngắt kết nối Slack",
  "connector.slack.disconnectAllSummary":
    "Mọi không gian làm việc đều bị ngắt kết nối. Mọi người không còn liên hệ được các trợ lý của bạn qua @OpenBot.",
  "connector.slack.disconnectAllSummaryOrchestrator":
    "Mọi không gian làm việc đều bị ngắt kết nối. Slack Orchestrator và các cuộc hội thoại của nó bị xóa khỏi OpenBot.",
  "connector.slack.missingScopes":
    "OpenBot không có các quyền này trong Slack: {scopes}. Hãy ngắt kết nối không gian làm việc, rồi kết nối lại.",
  "connector.slack.retryAt": "Slack đã yêu cầu OpenBot chờ. Nó thử lại lúc {time}.",
  "connector.slack.reconnect": "Kết nối lại",
  "connector.slack.pause": "Tạm dừng",
  "connector.slack.resume": "Tiếp tục",
  // {action} is a button, such as Pause; {name} is the workspace name.
  "connector.slack.rowAction": "{action}: {name}",
  "connector.slack.orchestratorTitle": "Slack Orchestrator",
  "connector.slack.orchestratorDescription":
    "Trợ lý này nhận mọi yêu cầu từ Slack. Nó tự trả lời các yêu cầu ngắn, giao việc khác cho trợ lý phù hợp và đăng câu trả lời trong luồng.",
  "connector.slack.orchestratorNone": "Chưa có trợ lý nào trả lời",
  "connector.slack.orchestratorNoneDescription":
    "Hãy thêm Slack Orchestrator, nếu không Slack sẽ không có câu trả lời.",
  "connector.slack.inviteNote":
    "OpenBot tự tham gia mọi kênh công khai, kể cả kênh mới. Với kênh riêng tư, hãy mời nó: /invite @OpenBot.",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.slack.stepWorkspace": "Không gian làm việc",
  "connector.slack.stepAgent": "Trợ lý",
  "connector.slack.connectTitle": "Kết nối không gian làm việc Slack",
  "connector.slack.connectDescription":
    "OpenBot cài đặt một ứng dụng tên OpenBot trong không gian làm việc và tham gia mọi kênh công khai.",
  "connector.slack.connectStepBrowser": "Slack mở trong trình duyệt của bạn",
  "connector.slack.connectStepAllow": "Chọn không gian làm việc ở góc trên bên phải, rồi nhấn Allow",
  "connector.slack.connectStepReturn": "Hộp thoại này tiếp tục khi Slack hoàn tất",
  "connector.slack.connectInSlack": "Kết nối trong Slack",
  "connector.slack.connectWaiting": "Đang chờ Slack. Hoàn tất cài đặt trong trình duyệt của bạn.",
  "connector.slack.agentStepTitle": "Thêm Slack Orchestrator",
  // {workspace} is the Slack workspace name.
  "connector.slack.agentStepDescription":
    "Trợ lý mới này trả lời mọi thứ mọi người gửi cho @OpenBot trong {workspace}.",
  "connector.slack.orchestratorName": "Slack Orchestrator",
  "connector.slack.orchestratorRole": "Trả lời trong Slack và hỏi nhóm",
  "connector.slack.orchestratorDoesReceive": "Nhận mọi yêu cầu Slack trước tiên",
  "connector.slack.orchestratorDoesDelegate": "Giao mỗi nhiệm vụ cho trợ lý phù hợp nhất",
  "connector.slack.orchestratorDoesAnswer": "Đăng câu trả lời trong luồng Slack",
  "connector.slack.orchestratorModel": "Mô hình",
  "connector.slack.doneTitle": "OpenBot đã có trong {workspace}",
  "connector.slack.doneDescription":
    "Nhắc @OpenBot trong bất kỳ kênh công khai nào, hoặc gửi cho nó tin nhắn trực tiếp.",
  "connector.slack.done": "Xong",
  "connector.slack.disconnectTitle": "Ngắt kết nối {workspace}?",
  "connector.slack.disconnectDescription":
    "OpenBot ngừng trả lời trong {workspace} và xóa token Slack khỏi máy tính này.",
  "connector.slack.disconnectDescriptionHost":
    "OpenBot ngừng trả lời trong {workspace} và xóa token Slack khỏi {host}.",
  "connector.slack.disconnectEffect":
    "Mọi người trong {workspace} không còn liên hệ được các trợ lý của bạn qua @OpenBot.",
  "connector.slack.removeEffectKept": "Các cuộc hội thoại và Slack Orchestrator vẫn ở trong OpenBot.",
  "connector.slack.removeEffectDeleted": "Slack Orchestrator và các cuộc hội thoại của nó bị xóa khỏi OpenBot.",
  "connector.slack.keep": "Giữ kết nối",
  "connector.slack.close": "Đóng",
  "connector.slack.addWorkspace": "Thêm không gian làm việc",
  // Shown when the page has the maximum number of workspaces.
  "connector.slack.limitReached": {
    other: "Bạn có thể kết nối tối đa {count} không gian làm việc.",
  },
  // {count} is the number of Slack workspaces: two or more.
  "connector.slack.summaryMany": {
    other: "{count} không gian làm việc · Slack Orchestrator trả lời",
  },

  // Marketplace > Apps > Discord: a Discord server (a guild) adds the one OpenBot bot, and
  // the Discord Orchestrator agent receives each request, asks the team and answers. Always write
  // "Discord server": "server" alone is an OpenBot server.
  "connector.discord.title": "Discord",
  "connector.discord.description":
    "Mọi người nhắc @OpenBot trong một kênh của máy chủ Discord. Discord Orchestrator hỏi trợ lý phù hợp và trả lời.",
  "connector.discord.statusConnected": "Đã kết nối",
  "connector.discord.statusAttention": "Cần xem xét",
  // {workspace} is the Discord server name.
  "connector.discord.summaryConnected": "{workspace} · Discord Orchestrator trả lời",
  "connector.discord.summaryNoAgent": "{workspace} · Chưa có trợ lý nào trả lời",
  "connector.discord.attentionTitle": {
    other: "{count} máy chủ Discord cần xem xét",
  },
  "connector.discord.attentionDescription": "Trạng thái bên dưới cho biết cần làm gì.",
  "connector.discord.connect": "Kết nối Discord",
  "connector.discord.addAgent": "Thêm trợ lý",
  "connector.discord.actionFailed": "Discord không chấp nhận thay đổi",
  "connector.discord.workspaceTitle": "Máy chủ Discord",
  "connector.discord.workspaceDescription": "Nhắc @OpenBot trong một kênh. Trả lời OpenBot để tiếp tục.",
  "connector.discord.disconnectWorkspace": "Ngắt kết nối",
  "connector.discord.disconnectAllTitle": "Ngắt kết nối Discord",
  "connector.discord.disconnectAllSummary":
    "Mọi máy chủ đều bị ngắt kết nối. Mọi người không còn liên hệ được các trợ lý của bạn qua @OpenBot.",
  "connector.discord.disconnectAllSummaryOrchestrator":
    "Mọi máy chủ đều bị ngắt kết nối. Discord Orchestrator và các cuộc hội thoại của nó bị xóa khỏi OpenBot.",
  "connector.discord.missingScopes":
    "OpenBot không có các quyền này trong Discord: {scopes}. Hãy ngắt kết nối máy chủ Discord, rồi kết nối lại.",
  "connector.discord.retryAt": "Discord đã yêu cầu OpenBot chờ. Nó thử lại lúc {time}.",
  "connector.discord.reconnect": "Kết nối lại",
  "connector.discord.pause": "Tạm dừng",
  "connector.discord.resume": "Tiếp tục",
  // {action} is a button, such as Pause; {name} is the Discord server name.
  "connector.discord.rowAction": "{action}: {name}",
  "connector.discord.orchestratorTitle": "Discord Orchestrator",
  "connector.discord.orchestratorDescription":
    "Trợ lý này nhận mọi yêu cầu từ Discord. Nó tự trả lời các yêu cầu ngắn, giao việc khác cho trợ lý phù hợp và trả lời trong kênh.",
  "connector.discord.orchestratorNone": "Chưa có trợ lý nào trả lời",
  "connector.discord.orchestratorNoneDescription":
    "Hãy thêm Discord Orchestrator, nếu không Discord sẽ không có câu trả lời.",
  "connector.discord.channelsNote": "OpenBot chỉ thấy các kênh mà vai trò của nó có thể xem.",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.discord.stepWorkspace": "Máy chủ Discord",
  "connector.discord.stepAgent": "Trợ lý",
  "connector.discord.connectTitle": "Kết nối máy chủ Discord",
  "connector.discord.connectDescription": "OpenBot thêm một bot tên OpenBot vào máy chủ Discord.",
  "connector.discord.connectStepBrowser": "Discord mở trong trình duyệt của bạn",
  "connector.discord.connectStepAllow": "Chọn máy chủ, rồi nhấn Authorize",
  "connector.discord.connectStepReturn": "Hộp thoại này tiếp tục khi Discord hoàn tất",
  "connector.discord.connectInDiscord": "Kết nối trong Discord",
  "connector.discord.connectWaiting": "Đang chờ Discord. Hoàn tất cấp quyền trong trình duyệt của bạn.",
  "connector.discord.agentStepTitle": "Thêm Discord Orchestrator",
  // {workspace} is the Discord server name.
  "connector.discord.agentStepDescription":
    "Trợ lý mới này trả lời mọi thứ mọi người gửi cho @OpenBot trong {workspace}.",
  "connector.discord.orchestratorName": "Discord Orchestrator",
  "connector.discord.orchestratorRole": "Trả lời trong Discord và hỏi nhóm",
  "connector.discord.orchestratorDoesReceive": "Nhận mọi yêu cầu Discord trước tiên",
  "connector.discord.orchestratorDoesDelegate": "Giao mỗi nhiệm vụ cho trợ lý phù hợp nhất",
  "connector.discord.orchestratorDoesAnswer": "Trả lời trong kênh Discord",
  "connector.discord.orchestratorModel": "Mô hình",
  "connector.discord.doneTitle": "OpenBot đã có trong {workspace}",
  "connector.discord.doneDescription": "Nhắc @OpenBot trong một kênh. Trả lời OpenBot để tiếp tục.",
  "connector.discord.done": "Xong",
  "connector.discord.disconnectTitle": "Ngắt kết nối {workspace}?",
  "connector.discord.disconnectDescription":
    "OpenBot ngừng trả lời trong {workspace} và xóa kết nối Discord khỏi máy tính này.",
  "connector.discord.disconnectDescriptionHost":
    "OpenBot ngừng trả lời trong {workspace} và xóa kết nối Discord khỏi {host}.",
  "connector.discord.disconnectEffect":
    "Mọi người trong {workspace} không còn liên hệ được các trợ lý của bạn qua @OpenBot.",
  "connector.discord.removeEffectKept": "Các cuộc hội thoại và Discord Orchestrator vẫn ở trong OpenBot.",
  "connector.discord.removeEffectDeleted": "Discord Orchestrator và các cuộc hội thoại của nó bị xóa khỏi OpenBot.",
  "connector.discord.keep": "Giữ kết nối",
  "connector.discord.close": "Đóng",
  "connector.discord.addWorkspace": "Thêm máy chủ Discord",
  "connector.discord.limitReached": {
    other: "Bạn có thể kết nối tối đa {count} máy chủ Discord.",
  },
  // {count} is the number of Discord servers: two or more.
  "connector.discord.summaryMany": {
    other: "{count} máy chủ Discord · Discord Orchestrator trả lời",
  },
  // Who can use OpenBot in one Discord server: the members with one of the chosen Discord roles.
  "connector.discord.accessTitle": "Ai có thể dùng OpenBot",
  "connector.discord.accessDescription": "OpenBot chỉ trả lời những người này. Nó bỏ qua các lượt nhắc từ người khác.",
  "connector.discord.accessEveryone": "Mọi người trong máy chủ",
  "connector.discord.accessEveryoneDescription":
    "Bất kỳ ai có thể đăng trong một kênh mà OpenBot nhìn thấy đều có thể nhắc nó.",
  // {roles} is a list of Discord role names, such as "Admin and Moderator".
  "connector.discord.accessRoles": "Thành viên có {roles}",
  "connector.discord.accessChoose": "Chọn vai trò",
  // {workspace} is the Discord server name.
  "connector.discord.accessDialogTitle": "Ai có thể dùng OpenBot trong {workspace}?",
  "connector.discord.accessDialogDescription": "Khi không chọn vai trò nào, mọi người đều có thể nhắc OpenBot.",
  "connector.discord.accessLoading": "Đang tải vai trò…",
  "connector.discord.accessLoadFailed": "Không tải được vai trò Discord",
  "connector.discord.accessNoRoles": "Máy chủ này không có vai trò nào để chọn.",
  // {role} is the name of a Discord role that the server no longer has.
  "connector.discord.accessRoleDeleted": "{role} (đã xóa)",
  "connector.discord.accessSave": "Lưu",
  // {host} is the joined server's name.
  "connector.discord.accessHostUpdate": "Cập nhật OpenBot trên {host} để chọn vai trò.",

  // Marketplace > Apps > Telegram: each chat adds the one OpenBot bot, and the Telegram
  // Orchestrator agent receives the messages of all chats, asks the team and answers.
  "connector.telegram.title": "Telegram",
  "connector.telegram.description":
    "Thêm bot OpenBot vào một nhóm Telegram hoặc mở một cuộc trò chuyện trực tiếp với bot. Telegram Orchestrator hỏi trợ lý phù hợp và trả lời.",
  "connector.telegram.statusConnected": "Đã kết nối",
  "connector.telegram.statusAttention": "Cần xem xét",
  // {count} is the number of linked Telegram chats.
  "connector.telegram.summaryConnected": {
    other: "{count} trò chuyện · Telegram Orchestrator trả lời",
  },
  "connector.telegram.summaryNoAgent": {
    other: "{count} trò chuyện · Chưa có trợ lý nào trả lời",
  },
  "connector.telegram.attentionTitle": {
    other: "{count} trò chuyện cần xem xét",
  },
  "connector.telegram.attentionDescription": "Trạng thái bên dưới cho biết cần làm gì.",
  "connector.telegram.connect": "Kết nối Telegram",
  "connector.telegram.addAgent": "Thêm trợ lý",
  "connector.telegram.actionFailed": "Telegram không chấp nhận thay đổi",
  "connector.telegram.chatsTitle": "Trò chuyện",
  "connector.telegram.groupDescription": "Mọi người nhắc bot hoặc trả lời tin nhắn của nó.",
  "connector.telegram.directDescription": "Mọi tin nhắn trong cuộc trò chuyện này đều đến Telegram Orchestrator.",
  "connector.telegram.helpRemoved":
    "Bot OpenBot không còn trong cuộc trò chuyện này. Hãy ngắt kết nối cuộc trò chuyện, rồi thêm bot lại.",
  "connector.telegram.helpRelayUnavailable":
    "OpenBot không thể nhận tin nhắn Telegram trên máy tính này. Hãy đăng nhập, đặt tên cho máy tính này trong Cài đặt máy chủ và giữ OpenBot mở.",
  "connector.telegram.helpRelayUnavailableHost":
    "OpenBot trên {host} không thể nhận tin nhắn Telegram. Trên {host}, hãy đăng nhập, đặt tên cho máy chủ trong Cài đặt máy chủ và giữ OpenBot mở.",
  "connector.telegram.helpError":
    "OpenBot không thể liên hệ cuộc trò chuyện này. Hãy kết nối lại, hoặc ngắt kết nối cuộc trò chuyện.",
  "connector.telegram.retryAt": "Telegram đã yêu cầu OpenBot chờ. Nó thử lại lúc {time}.",
  "connector.telegram.pause": "Tạm dừng",
  "connector.telegram.resume": "Tiếp tục",
  "connector.telegram.reconnect": "Kết nối lại",
  "connector.telegram.disconnectChat": "Ngắt kết nối",
  "connector.telegram.disconnectAllTitle": "Ngắt kết nối Telegram",
  "connector.telegram.disconnectAllSummary":
    "Mọi cuộc trò chuyện đều bị ngắt kết nối. Mọi người không còn liên hệ được các trợ lý của bạn qua bot OpenBot.",
  "connector.telegram.disconnectAllSummaryOrchestrator":
    "Mọi cuộc trò chuyện đều bị ngắt kết nối. Telegram Orchestrator và các cuộc hội thoại của nó bị xóa khỏi OpenBot.",
  // {action} is a button, such as Pause; {name} is the chat name.
  "connector.telegram.rowAction": "{action}: {name}",
  "connector.telegram.linkChat": "Liên kết một cuộc trò chuyện",
  "connector.telegram.addToGroup": "Thêm vào một nhóm",
  "connector.telegram.openDirectChat": "Mở một cuộc trò chuyện trực tiếp",
  "connector.telegram.orchestratorTitle": "Telegram Orchestrator",
  "connector.telegram.orchestratorDescription":
    "Trợ lý này nhận tin nhắn của OpenBot từ tất cả cuộc trò chuyện Telegram của bạn. Nó tự trả lời các tin nhắn ngắn, giao việc khác cho trợ lý phù hợp và đăng câu trả lời trong cuộc trò chuyện.",
  "connector.telegram.orchestratorNone": "Chưa có trợ lý nào trả lời",
  "connector.telegram.orchestratorNoneDescription":
    "Hãy thêm Telegram Orchestrator, nếu không Telegram sẽ không có câu trả lời.",
  "connector.telegram.mentionNote":
    "Trong nhóm, hãy nhắc bot hoặc trả lời tin nhắn của nó. Trong cuộc trò chuyện trực tiếp, mọi tin nhắn đều đến bot.",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.telegram.stepChat": "Trò chuyện",
  "connector.telegram.stepAgent": "Trợ lý",
  "connector.telegram.connectTitle": "Liên kết một cuộc trò chuyện Telegram",
  "connector.telegram.connectDescription":
    "Thêm bot OpenBot vào một nhóm, hoặc mở một cuộc trò chuyện trực tiếp với bot. Một bot phục vụ tất cả cuộc trò chuyện của bạn.",
  "connector.telegram.connectStepBrowser": "Telegram mở trong trình duyệt của bạn",
  "connector.telegram.connectStepPick": "Chọn nhóm, hoặc nhấn Start trong cuộc trò chuyện trực tiếp",
  "connector.telegram.connectStepReturn": "Hộp thoại này tiếp tục khi cuộc trò chuyện được liên kết",
  "connector.telegram.connectWaiting": "Đang chờ Telegram. Chọn cuộc trò chuyện trong Telegram.",
  "connector.telegram.agentStepTitle": "Thêm Telegram Orchestrator",
  // {chat} is the Telegram chat name.
  "connector.telegram.agentStepDescription":
    "Trợ lý mới này trả lời tin nhắn của OpenBot trong {chat} và trong mỗi cuộc trò chuyện bạn liên kết sau này.",
  "connector.telegram.orchestratorName": "Telegram Orchestrator",
  "connector.telegram.orchestratorRole": "Trả lời trong Telegram và hỏi nhóm",
  "connector.telegram.orchestratorDoesReceive": "Nhận mọi tin nhắn Telegram của OpenBot trước tiên",
  "connector.telegram.orchestratorDoesDelegate": "Giao mỗi nhiệm vụ cho trợ lý phù hợp nhất",
  "connector.telegram.orchestratorDoesAnswer": "Đăng câu trả lời trong cuộc trò chuyện Telegram",
  "connector.telegram.orchestratorModel": "Mô hình",
  "connector.telegram.doneTitle": "OpenBot đã có trong {chat}",
  "connector.telegram.done": "Xong",
  "connector.telegram.disconnectTitle": "Ngắt kết nối {chat}?",
  "connector.telegram.leaveDescription": "Bot OpenBot rời khỏi {chat}, và OpenBot ngừng trả lời ở đó.",
  "connector.telegram.disconnectEffect":
    "Mọi người trong {chat} không còn liên hệ được các trợ lý của bạn qua bot OpenBot.",
  "connector.telegram.removeEffectKept": "Các cuộc hội thoại và Telegram Orchestrator vẫn ở trong OpenBot.",
  "connector.telegram.removeEffectDeleted":
    "Đây là cuộc trò chuyện cuối cùng, nên Telegram Orchestrator và các cuộc hội thoại của nó bị xóa khỏi OpenBot.",
  "connector.telegram.keep": "Giữ kết nối",
  "connector.telegram.close": "Đóng",
  // Marketplace > Apps > WhatsApp: a WhatsApp number links this computer as a device, and the
  // WhatsApp Orchestrator agent receives the messages of all numbers, asks the team and answers.
  "connector.whatsapp.title": "WhatsApp",
  "connector.whatsapp.description":
    "Liên kết một số WhatsApp với máy tính này. WhatsApp Orchestrator hỏi trợ lý phù hợp và trả lời.",
  "connector.whatsapp.descriptionHost":
    "Liên kết một số WhatsApp với máy chủ này. WhatsApp Orchestrator hỏi trợ lý phù hợp và trả lời.",
  "connector.whatsapp.statusConnected": "Đã kết nối",
  "connector.whatsapp.statusAttention": "Cần xem xét",
  // {count} is the number of linked WhatsApp numbers.
  "connector.whatsapp.summaryConnected": {
    other: "{count} số · WhatsApp Orchestrator trả lời",
  },
  "connector.whatsapp.summaryNoAgent": {
    other: "{count} số · Chưa có trợ lý nào trả lời",
  },
  "connector.whatsapp.attentionTitle": {
    other: "{count} số cần xem xét",
  },
  "connector.whatsapp.attentionDescription": "Trạng thái bên dưới cho biết cần làm gì.",
  "connector.whatsapp.connect": "Liên kết WhatsApp",
  "connector.whatsapp.addAgent": "Thêm trợ lý",
  "connector.whatsapp.actionFailed": "WhatsApp không chấp nhận thay đổi",
  "connector.whatsapp.numbersTitle": "Số",
  "connector.whatsapp.linkNumber": "Liên kết một số",
  "connector.whatsapp.ownNumberNote":
    "Cuộc trò chuyện “Message yourself” của bạn và những người bạn cho phép liên hệ OpenBot.",
  "connector.whatsapp.dedicatedNote":
    "Những người bạn cho phép liên hệ OpenBot. Người khác nhận một mã để đưa cho bạn.",
  "connector.whatsapp.helpLoggedOut":
    "WhatsApp đã xóa máy tính này khỏi các thiết bị đã liên kết. Hãy liên kết số đó lại.",
  "connector.whatsapp.helpLoggedOutHost":
    "WhatsApp đã xóa máy chủ này khỏi các thiết bị đã liên kết. Hãy liên kết số đó lại.",
  "connector.whatsapp.helpError":
    "OpenBot không thể liên hệ WhatsApp trên số này. Hãy kết nối lại, hoặc ngắt kết nối số đó.",
  "connector.whatsapp.retryAt": "WhatsApp đã yêu cầu OpenBot chờ. Nó thử lại lúc {time}.",
  "connector.whatsapp.pause": "Tạm dừng",
  "connector.whatsapp.resume": "Tiếp tục",
  "connector.whatsapp.reconnect": "Kết nối lại",
  "connector.whatsapp.linkAgain": "Liên kết lại",
  "connector.whatsapp.disconnect": "Ngắt kết nối",
  "connector.whatsapp.disconnectAllTitle": "Ngắt kết nối WhatsApp",
  "connector.whatsapp.disconnectAllSummary":
    "Mọi số đều bị ngắt kết nối. Mọi người không còn liên hệ được các trợ lý của bạn qua WhatsApp.",
  "connector.whatsapp.disconnectAllSummaryOrchestrator":
    "Mọi số đều bị ngắt kết nối. WhatsApp Orchestrator và các cuộc hội thoại của nó bị xóa khỏi OpenBot.",
  // {action} is a button, such as Pause; {name} is the WhatsApp number or a person's name.
  "connector.whatsapp.rowAction": "{action}: {name}",
  "connector.whatsapp.ownNumber": "Số cá nhân",
  "connector.whatsapp.ownNumberDescription":
    "Chỉ cuộc trò chuyện “Message yourself” của bạn và những người bạn cho phép mới có thể nhắn. Hãy tắt với số chỉ dùng cho OpenBot.",
  "connector.whatsapp.orchestratorTitle": "WhatsApp Orchestrator",
  "connector.whatsapp.orchestratorDescription":
    "Trợ lý này nhận tin nhắn của OpenBot từ tất cả số đã liên kết của bạn. Nó tự trả lời các tin nhắn ngắn, giao việc khác cho trợ lý phù hợp và trả lời trong WhatsApp.",
  "connector.whatsapp.orchestratorNone": "Chưa có trợ lý nào trả lời",
  "connector.whatsapp.orchestratorNoneDescription":
    "Hãy thêm WhatsApp Orchestrator, nếu không WhatsApp sẽ không có câu trả lời.",
  "connector.whatsapp.note":
    "Trên số cá nhân của bạn, hãy nhắn trong cuộc trò chuyện “Message yourself”. Những người bạn cho phép sẽ nhắn vào số đó.",
  // The link dialog. The steps show as numbers; screen readers read the names.
  "connector.whatsapp.stepNumber": "Số",
  "connector.whatsapp.stepAgent": "Trợ lý",
  "connector.whatsapp.connectTitle": "Liên kết WhatsApp",
  "connector.whatsapp.connectDescription": "Chọn số, rồi liên kết máy tính này từ WhatsApp trên điện thoại của bạn.",
  "connector.whatsapp.connectDescriptionHost": "Chọn số, rồi liên kết máy chủ này từ WhatsApp trên điện thoại của bạn.",
  "connector.whatsapp.kindLabel": "Số",
  "connector.whatsapp.kindPersonal": "Số cá nhân của tôi",
  "connector.whatsapp.kindPersonalDescription":
    "OpenBot chỉ trả lời cuộc trò chuyện “Message yourself” của bạn và những người bạn cho phép.",
  "connector.whatsapp.kindDedicated": "Một số chỉ dùng cho OpenBot",
  "connector.whatsapp.kindDedicatedDescription": "Người lạ nhận một mã để đưa cho bạn. Bạn phê duyệt họ tại đây.",
  "connector.whatsapp.methodLabel": "Cách liên kết",
  "connector.whatsapp.methodQr": "Mã QR",
  "connector.whatsapp.methodCode": "Mã ghép nối",
  "connector.whatsapp.phoneLabel": "Số điện thoại",
  "connector.whatsapp.phoneDescription": "Kèm mã quốc gia, ví dụ +44 7700 900123.",
  "connector.whatsapp.phoneInvalid": "Nhập số điện thoại kèm mã quốc gia.",
  "connector.whatsapp.showQr": "Hiện mã QR",
  "connector.whatsapp.getCode": "Lấy mã",
  "connector.whatsapp.starting": "Đang yêu cầu mã từ WhatsApp…",
  "connector.whatsapp.connectStepOpen": "Mở WhatsApp trên điện thoại của bạn",
  "connector.whatsapp.connectStepDevices": "Chạm Settings, rồi Linked devices, rồi Link a device",
  "connector.whatsapp.connectStepScan": "Hướng điện thoại vào mã này",
  "connector.whatsapp.connectWaiting": "Đang chờ điện thoại. Mã thay đổi khoảng 20 giây một lần.",
  "connector.whatsapp.qrLabel": "Mã liên kết WhatsApp",
  "connector.whatsapp.codeStepDevices": "Trong WhatsApp, mở Linked devices và chạm Link a device",
  "connector.whatsapp.codeStepPhone": "Chạm Link with phone number instead",
  "connector.whatsapp.codeStepType": "Nhập mã này trên điện thoại",
  // {code} is the pairing code, read one character at a time.
  "connector.whatsapp.codeLabel": "Mã ghép nối {code}",
  "connector.whatsapp.copyCode": "Sao chép mã",
  "connector.whatsapp.codeWaiting": "Đang chờ điện thoại.",
  "connector.whatsapp.failedTitle": "WhatsApp không liên kết được",
  "connector.whatsapp.failedTimeout": "Mã đã hết hạn trước khi điện thoại dùng.",
  "connector.whatsapp.failedRefused": "WhatsApp đã từ chối liên kết. Hãy chờ vài phút rồi thử lại.",
  "connector.whatsapp.failedBusy": "Một liên kết khác đang chạy. Hãy chờ nó xong rồi thử lại.",
  "connector.whatsapp.failedUnavailable": "OpenBot không thể liên hệ WhatsApp. Hãy kiểm tra kết nối internet.",
  "connector.whatsapp.tryAgain": "Thử lại",
  "connector.whatsapp.agentStepTitle": "Thêm WhatsApp Orchestrator",
  // {number} is the WhatsApp number or its name.
  "connector.whatsapp.agentStepDescription":
    "Trợ lý mới này trả lời tin nhắn của OpenBot trên {number} và trên mỗi số bạn liên kết sau này.",
  "connector.whatsapp.orchestratorName": "WhatsApp Orchestrator",
  "connector.whatsapp.orchestratorRole": "Trả lời trong WhatsApp và hỏi nhóm",
  "connector.whatsapp.orchestratorDoesReceive": "Nhận mọi tin nhắn WhatsApp của OpenBot trước tiên",
  "connector.whatsapp.orchestratorDoesDelegate": "Giao mỗi nhiệm vụ cho trợ lý phù hợp nhất",
  "connector.whatsapp.orchestratorDoesAnswer": "Trả lời trong cuộc trò chuyện WhatsApp",
  "connector.whatsapp.orchestratorModel": "Mô hình",
  "connector.whatsapp.doneTitle": "OpenBot đã liên kết với {number}",
  "connector.whatsapp.done": "Xong",
  "connector.whatsapp.disconnectTitle": "Ngắt kết nối {number}?",
  "connector.whatsapp.disconnectDescription":
    "OpenBot đăng xuất khỏi WhatsApp trên {number}. Nếu OpenBot đã tắt, hãy xóa thiết bị trong WhatsApp > Linked devices.",
  "connector.whatsapp.disconnectEffect": "Mọi người không còn liên hệ được các trợ lý của bạn qua {number}.",
  "connector.whatsapp.removeEffectKept": "Các cuộc hội thoại và WhatsApp Orchestrator vẫn ở trong OpenBot.",
  "connector.whatsapp.removeEffectDeleted":
    "Đây là số cuối cùng, nên WhatsApp Orchestrator và các cuộc hội thoại của nó bị xóa khỏi OpenBot.",
  "connector.whatsapp.keep": "Giữ liên kết",
  "connector.whatsapp.close": "Đóng",
  // Who can give work through one number: contacts by phone number, and groups.
  "connector.whatsapp.sendersTitle": "Ai có thể nhắn cho {number}",
  "connector.whatsapp.sendersDescription": "Các liên hệ và nhóm này có thể giao việc cho các trợ lý của bạn.",
  "connector.whatsapp.sendersEmpty": "Chỉ bạn mới có thể nhắn. Hãy thêm một liên hệ hoặc một nhóm.",
  "connector.whatsapp.sendersLimit": "Một số có thể cho phép tối đa {count} liên hệ và nhóm.",
  "connector.whatsapp.senderGroup": "Nhóm",
  "connector.whatsapp.removeSender": "Gỡ bỏ",
  "connector.whatsapp.addContact": "Thêm liên hệ",
  "connector.whatsapp.addGroup": "Thêm nhóm",
  "connector.whatsapp.contactTitle": "Thêm một liên hệ",
  "connector.whatsapp.contactDescription": "Người này có thể giao việc cho các trợ lý của bạn từ WhatsApp.",
  "connector.whatsapp.contactName": "Tên",
  "connector.whatsapp.contactNameDescription": "Không bắt buộc. Nếu để trống, danh sách hiện số điện thoại.",
  "connector.whatsapp.add": "Thêm",
  "connector.whatsapp.groupTitle": "Thêm một nhóm",
  "connector.whatsapp.groupDescription": "Mọi người trong nhóm này có thể giao việc cho các trợ lý của bạn.",
  "connector.whatsapp.groupSearch": "Tìm nhóm",
  "connector.whatsapp.groupsLoading": "Đang đọc các nhóm…",
  "connector.whatsapp.groupsLoadFailed": "OpenBot không thể đọc các nhóm",
  "connector.whatsapp.groupsEmpty": "Số này không thuộc nhóm nào.",
  "connector.whatsapp.groupsNoMatch": "Không có nhóm nào có tên này.",
  "connector.whatsapp.groupAdded": "Đã thêm",
  // People who wrote to a number only for OpenBot and got a code to give the owner.
  "connector.whatsapp.requestsTitle": "Yêu cầu cho {number}",
  "connector.whatsapp.requestsDescription":
    "Những người này đã nhắn cho số đó và nhận một mã. Chỉ phê duyệt khi họ đưa cho bạn đúng mã đó.",
  "connector.whatsapp.requestsEmpty": "Không có yêu cầu nào.",
  // {code} is the 6-character code; {number} is the person's phone number, partly hidden.
  "connector.whatsapp.requestDetail": "Mã {code} · {number}",
  "connector.whatsapp.approve": "Phê duyệt",
  "connector.whatsapp.deny": "Từ chối",
  // Marketplace > 1Password: a vault that the user shares with OpenBot through a service account.
  "connector.onePassword.title": "1Password",
  "connector.onePassword.description":
    "Chia sẻ một kho 1Password riêng với OpenBot qua tài khoản dịch vụ, để các trợ lý có thể đăng nhập vào các trang trong trình duyệt OpenBot.",
  "connector.onePassword.howItWorks":
    "Kết nối sẽ thiết lập một kho “Shared with OpenBot” trong tài khoản 1Password của bạn và một tài khoản dịch vụ chỉ đọc được kho đó. OpenBot điền các thông tin đăng nhập đã lưu trong trình duyệt trên máy tính này, nên chỉ những mục bạn chuyển vào kho đó mới được chia sẻ. Các trợ lý không bao giờ thấy mật khẩu.",
  "connector.onePassword.connect": "Kết nối 1Password",
  // The three setup steps before a connection, each with the one button it needs.
  "connector.onePassword.setupTitle": "Thiết lập",
  "connector.onePassword.stepCliTitle": "Cài đặt 1Password CLI",
  "connector.onePassword.stepCliChecking": "Đang tìm 1Password CLI trên máy tính này",
  "connector.onePassword.stepCliInstalling": "Đang tải 1Password CLI từ 1Password",
  // {version} is a version number, such as 2.39.0.
  "connector.onePassword.stepCliReady": "Phiên bản {version} đã được cài đặt.",
  "connector.onePassword.stepCliMissing":
    "OpenBot tải nó từ 1Password vào thư mục riêng của nó. Không cần mật khẩu quản trị.",
  "connector.onePassword.stepCliManual":
    "OpenBot không thể cài đặt nó trên máy tính này. Hãy cài đặt từ 1Password, rồi quay lại trang này.",
  "connector.onePassword.installCli": "Cài đặt",
  "connector.onePassword.stepAppTitle": "Bật tích hợp CLI",
  "connector.onePassword.stepAppDescription":
    "Trong ứng dụng 1Password, mở Settings > Developer và bật “Integrate with 1Password CLI”.",
  "connector.onePassword.stepAppReady": "Ứng dụng 1Password cho phép CLI tạo kho dùng chung.",
  "connector.onePassword.openApp": "Mở 1Password",
  "connector.onePassword.openAppFailed": "OpenBot không thể mở 1Password.",
  "connector.onePassword.checkAgain": "Kiểm tra lại",
  "connector.onePassword.stepVaultTitle": "Tạo kho dùng chung",
  "connector.onePassword.stepVaultDescription":
    "OpenBot tạo kho “Shared with OpenBot” và một tài khoản dịch vụ chỉ đọc được kho đó. 1Password yêu cầu bạn phê duyệt.",
  // The last row of the setup steps: the other way to connect, without the CLI.
  "connector.onePassword.useTokenDescription":
    "Thay vì các bước này, hãy dán token tài khoản dịch vụ từ 1Password.com.",
  "connector.onePassword.useTokenAction": "Dùng token",
  "connector.onePassword.tokenLabel": "Token tài khoản dịch vụ",
  "connector.onePassword.tokenPlaceholder": "ops_…",
  "connector.onePassword.connectWithToken": "Kết nối",
  "connector.onePassword.approveInApp": "Phê duyệt yêu cầu trong ứng dụng 1Password",
  "connector.onePassword.cancel": "Hủy",
  "connector.onePassword.chooseAccountTitle": "Chọn một tài khoản",
  "connector.onePassword.chooseAccountDescription": "OpenBot tạo kho dùng chung trong tài khoản bạn chọn.",
  "connector.onePassword.useAccount": "Dùng tài khoản này",
  "connector.onePassword.vaultTitle": "Kho dùng chung",
  "connector.onePassword.vaultDescription":
    "Chuyển một thông tin đăng nhập vào kho này trong 1Password để các trợ lý dùng nó đăng nhập. Xóa nó để dừng.",
  "connector.onePassword.loginsLoading": "Đang đọc các thông tin đăng nhập từ 1Password",
  // {count} is a number, such as 3.
  "connector.onePassword.loginCount": { other: "{count} thông tin đăng nhập" },
  "connector.onePassword.disconnect": "Ngắt kết nối",
  "connector.onePassword.disconnectTitle": "Ngắt kết nối 1Password",
  "connector.onePassword.disconnectSummary":
    "OpenBot quên token. Kho và tài khoản dịch vụ vẫn ở trong 1Password; hãy xóa chúng ở đó nếu bạn không còn cần.",
  "connector.onePassword.actionFailed": "OpenBot không thể thay đổi kết nối 1Password.",
  "connector.onePassword.statusConnected": "Đã kết nối",
  "connector.onePassword.statusConnecting": "Đang kết nối",
  // The same page for the connection of a joined server. {host} is the server name, such as Studio.
  "connector.onePassword.descriptionHost":
    "Chia sẻ một kho 1Password riêng với OpenBot trên {host} qua tài khoản dịch vụ, để các trợ lý trên {host} có thể đăng nhập vào các trang trong trình duyệt của máy chủ.",
  "connector.onePassword.howItWorksHost":
    "{host} kết nối bằng token tài khoản dịch vụ. Trên 1Password.com, hãy tạo một tài khoản dịch vụ chỉ đọc được kho bạn chia sẻ với OpenBot, rồi dán token đó vào đây. {host} kiểm tra token và giữ lại; máy tính này thì không. Các trợ lý không bao giờ thấy mật khẩu.",
  "connector.onePassword.disconnectSummaryHost":
    "{host} quên token. Kho và tài khoản dịch vụ vẫn ở trong 1Password; hãy xóa chúng ở đó nếu bạn không còn cần.",
  "connector.bitwarden.title": "Bitwarden",
  "connector.bitwarden.description": "Điền thông tin đăng nhập trong trình duyệt từ Bitwarden.",
  "connector.bitwarden.setup":
    "Cài đặt Bitwarden CLI và đăng nhập bằng bw login. Tạo một thư mục tên Shared with OpenBot và chỉ đặt vào đó những thông tin đăng nhập mà trợ lý được phép dùng. Chạy bw unlock --raw và dán khóa phiên xuống dưới. Không dán mật khẩu chính của bạn.",
  "connector.bitwarden.scope":
    "Mọi trợ lý trên máy tính này đều có thể dùng các thông tin đăng nhập khớp trong Shared with OpenBot. OpenBot dùng đúng nguồn HTTPS. Nó không dùng các mục cần nhập mật khẩu chính hoặc cần quy tắc khớp URI tùy chỉnh.",
  "connector.bitwarden.session":
    "Khóa phiên chỉ nằm trong bộ nhớ. Hãy kết nối lại sau 8 giờ không dùng kho, hoặc sau khi OpenBot thoát. Ngắt kết nối sẽ chặn OpenBot truy cập; nó không khóa các ứng dụng Bitwarden khác.",
  "connector.bitwarden.sessionKey": "Khóa phiên Bitwarden",
  "connector.bitwarden.connect": "Kết nối Bitwarden",
  "connector.bitwarden.disconnect": "Ngắt kết nối Bitwarden",
  "connector.bitwarden.disconnectAction": "Ngắt kết nối",
  "connector.bitwarden.disconnectSummary":
    "OpenBot quên khóa phiên. Các trợ lý không còn điền thông tin đăng nhập từ Bitwarden. Các ứng dụng Bitwarden khác vẫn mở khóa.",
  "connector.bitwarden.disconnectSummaryHost":
    "{host} xóa khóa API và mật khẩu chính. Các trợ lý trên {host} không còn điền thông tin đăng nhập từ Bitwarden.",
  "connector.bitwarden.connected": "Đã kết nối",
  "connector.bitwarden.actionFailed": "OpenBot không thể thay đổi kết nối Bitwarden.",
  "connector.bitwarden.descriptionHost":
    "Điền thông tin đăng nhập trong trình duyệt trên {host} từ Bitwarden hoặc Vaultwarden.",
  "connector.bitwarden.setupHost":
    "{host} đăng nhập bằng Bitwarden CLI của riêng nó. Trong kho của bạn, hãy tạo một thư mục tên Shared with OpenBot và chỉ đặt vào đó những thông tin đăng nhập mà trợ lý được phép dùng. Trong kho web, mở Settings › Security › Keys và xem khóa API của bạn. Nhập địa chỉ máy chủ, client_id, client_secret và mật khẩu chính của bạn xuống dưới.",
  "connector.bitwarden.scopeHost":
    "Mọi trợ lý trên {host} đều có thể dùng các thông tin đăng nhập khớp trong Shared with OpenBot. OpenBot dùng đúng nguồn HTTPS. Nó không dùng các mục cần nhập mật khẩu chính hoặc cần quy tắc khớp URI tùy chỉnh.",
  "connector.bitwarden.sessionHost":
    "{host} giữ khóa API và mật khẩu chính ở dạng mã hóa, nên nó có thể mở khóa lại sau khi khởi động lại. Máy tính này không giữ chúng. Ngắt kết nối sẽ xóa chúng khỏi {host}. {host} phải truy cập được địa chỉ máy chủ qua HTTPS.",
  "connector.bitwarden.serverUrl": "Địa chỉ máy chủ",
  "connector.bitwarden.folderTitle": "Thư mục dùng chung",
  "connector.bitwarden.folderDescription":
    "Chuyển một thông tin đăng nhập vào thư mục này trong Bitwarden để các trợ lý dùng nó đăng nhập. Xóa nó để dừng.",
  // The exact folder name that OpenBot looks for in the vault. Keep it in English.
  "connector.bitwarden.folderName": "Shared with OpenBot",
  "connector.bitwarden.folderKind": "Thư mục trong Bitwarden",
  "connector.bitwarden.clientId": "client_id của khóa API",
  "connector.bitwarden.clientSecret": "client_secret của khóa API",
  "connector.bitwarden.masterPassword": "Mật khẩu chính",
  "connector.bitwarden.connecting": "Đang kết nối",
  "connector.protonPass.title": "Proton Pass",
  "connector.protonPass.description":
    "Cho phép các trợ lý đăng nhập vào các trang bằng thông tin đăng nhập trong một kho Proton Pass dùng chung.",
  "connector.protonPass.descriptionHost":
    "Cho phép các trợ lý trên {host} đăng nhập vào các trang bằng thông tin đăng nhập trong một kho Proton Pass dùng chung.",
  "connector.protonPass.connect": "Kết nối",
  "connector.protonPass.moreWays": "Cách kết nối khác",
  "connector.protonPass.useKey": "Dùng khóa truy cập",
  "connector.protonPass.keyLabel": "Khóa truy cập",
  // A Proton Pass access key starts with pst_.
  "connector.protonPass.keyPlaceholder": "pst_…",
  "connector.protonPass.setupTitle": "Thiết lập",
  "connector.protonPass.setupDescription":
    "Kết nối sẽ mở trang đăng nhập Proton trong trình duyệt của bạn. Sau đó OpenBot tạo kho dùng chung và chỉ giữ lại một khóa chỉ đọc cho kho đó.",
  "connector.protonPass.setupDescriptionHost":
    "Kết nối sẽ mở trang đăng nhập Proton trong trình duyệt của bạn. Sau đó {host} tạo kho dùng chung và chỉ giữ lại một khóa chỉ đọc cho kho đó.",
  // The exact vault name that OpenBot makes in Proton Pass. Keep it in English.
  "connector.protonPass.vaultName": "Shared with OpenBot",
  "connector.protonPass.vaultSetup":
    "OpenBot tạo kho này khi bạn kết nối. Chuyển thông tin đăng nhập vào đó để chia sẻ.",
  "connector.protonPass.showSteps": "Hiện các bước",
  "connector.protonPass.stepsLabel": "Các bước kết nối",
  "connector.protonPass.stepSignIn": "Đăng nhập",
  "connector.protonPass.stepVault": "Tạo kho dùng chung",
  "connector.protonPass.stepDone": "Xong",
  "connector.protonPass.signInTitle": "Đăng nhập vào Proton",
  "connector.protonPass.signInStarting": "OpenBot bắt đầu đăng nhập. Trang Proton mở trong trình duyệt của bạn.",
  "connector.protonPass.signInDescription":
    "Trang đăng nhập đã mở trong trình duyệt của bạn. Proton yêu cầu mật khẩu và yếu tố xác thực thứ hai của bạn.",
  "connector.protonPass.signInDescriptionHost":
    "Trang đăng nhập cho {host} đã mở trong trình duyệt của bạn. Proton yêu cầu mật khẩu và yếu tố xác thực thứ hai của bạn.",
  "connector.protonPass.extraPasswordDescription": "Proton Pass yêu cầu mật khẩu phụ của bạn.",
  "connector.protonPass.extraPasswordWrong": "Mật khẩu phụ không đúng. Hãy nhập lại.",
  "connector.protonPass.extraPasswordLabel": "Mật khẩu phụ",
  "connector.protonPass.continue": "Tiếp tục",
  "connector.protonPass.setupStepTitle": "Tạo kho dùng chung",
  "connector.protonPass.setupStepDescription":
    "OpenBot tạo kho “{vault}” và một khóa chỉ đọc cho kho đó. Sau đó nó đăng xuất khỏi phiên Proton của bạn.",
  "connector.protonPass.doneTitle": "Proton Pass đã kết nối",
  "connector.protonPass.doneDescription":
    "Chuyển thông tin đăng nhập vào “{vault}” để các trợ lý dùng chúng đăng nhập.",
  "connector.protonPass.failedTitle": "Proton Pass không kết nối được",
  "connector.protonPass.copyLink": "Sao chép liên kết",
  "connector.protonPass.linkCopied": "Đã sao chép",
  "connector.protonPass.openAgain": "Mở lại",
  "connector.protonPass.done": "Xong",
  "connector.protonPass.close": "Đóng",
  "connector.protonPass.statusConnecting": "Đang kết nối",
  "connector.protonPass.statusConnected": "Đã kết nối",
  "connector.protonPass.statusExpired": "Khóa đã hết hạn",
  "connector.protonPass.expiredTitle": "Khóa Proton Pass đã hết hạn",
  "connector.protonPass.expiredDescription":
    "Các trợ lý không thể đăng nhập bằng các thông tin đăng nhập dùng chung của bạn cho đến khi bạn đăng nhập lại.",
  "connector.protonPass.reconnect": "Kết nối lại",
  "connector.protonPass.planTitle": "Proton Pass cần một gói trả phí",
  "connector.protonPass.planDescription":
    "Proton Pass CLI chỉ hoạt động với gói Proton trả phí. Hãy đổi gói của bạn, rồi kết nối lại.",
  "connector.protonPass.vaultTitle": "Kho dùng chung",
  "connector.protonPass.vaultDescription":
    "Các trợ lý có thể đăng nhập bằng các thông tin đăng nhập trong kho này. Chuyển một thông tin đăng nhập vào đó để chia sẻ.",
  "connector.protonPass.loginCount": { other: "{count} thông tin đăng nhập" },
  "connector.protonPass.loginsLoading": "Đang đếm các thông tin đăng nhập…",
  "connector.protonPass.keyExpires": "Chỉ đọc. Hết hạn vào {date}.",
  "connector.protonPass.keyExpired": "Chỉ đọc. Đã hết hạn vào {date}.",
  "connector.protonPass.keyNoExpiry": "Chỉ đọc. Không hết hạn.",
  "connector.protonPass.disconnectTitle": "Ngắt kết nối Proton Pass",
  "connector.protonPass.disconnectSummary":
    "OpenBot xóa khóa truy cập của nó trên máy tính này. Kho và các thông tin đăng nhập vẫn ở trong tài khoản Proton của bạn.",
  "connector.protonPass.disconnectSummaryHost":
    "OpenBot xóa khóa truy cập của nó trên {host}. Kho và các thông tin đăng nhập vẫn ở trong tài khoản Proton của bạn.",
  "connector.protonPass.disconnect": "Ngắt kết nối",
  "connector.protonPass.actionFailed": "OpenBot không thể thay đổi kết nối Proton Pass.",
} as const satisfies PartialTranslation<typeof source>;
