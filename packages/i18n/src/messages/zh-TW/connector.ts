import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/connector";

export const messages = {
  // Marketplace > Apps > GitHub: the built-in GitHub connection.
  "connector.github.title": "GitHub",
  "connector.github.description": "這臺電腦上的每個助理都可以使用你的 GitHub 倉庫、Issue 和拉取請求，以及 gh 和 git。",
  "connector.github.connect": "連線 GitHub",
  "connector.github.pendingTitle": "在 GitHub 上輸入該驗證碼",
  "connector.github.pendingDescription": "GitHub 已在瀏覽器中開啟，在那裡輸入驗證碼即可完成連線。",
  "connector.github.waiting": "正在等待 GitHub",
  "connector.github.copyCode": "複製驗證碼",
  "connector.github.codeCopied": "已複製",
  "connector.github.openGitHub": "開啟 GitHub",
  "connector.github.cancel": "取消",
  "connector.github.connectedAs": "已連線為 @{login}",
  "connector.github.repositoriesTitle": "倉庫",
  "connector.github.repositoriesDescription": "助理只能使用已安裝 OpenBot GitHub App 的倉庫。",
  "connector.github.chooseRepositories": "選擇倉庫",
  "connector.github.repositoriesLoading": "正在從 GitHub 讀取倉庫",
  "connector.github.repositoriesFailed": "OpenBot 無法從 GitHub 讀取倉庫。",
  "connector.github.noRepositories": "尚未在任何倉庫上安裝 OpenBot GitHub App。",
  // {count} is a number, such as 12.
  "connector.github.moreRepositories": { one: "還有 {count} 個倉庫", other: "還有 {count} 個倉庫" },
  // A badge next to a repository that only its members can see.
  "connector.github.private": "私有",
  "connector.github.disconnect": "斷開連線",
  "connector.github.disconnectTitle": "斷開 GitHub？",
  "connector.github.disconnectSummary": "所有助理都將失去 GitHub，聊天和檔案仍會保留。",
  "connector.github.expiredTitle": "GitHub 連線已過期",
  "connector.github.expiredDescription": "以 @{login} 重新連線，即可讓助理繼續使用 GitHub。",
  "connector.github.reconnect": "重新連線",
  "connector.github.actionFailed": "OpenBot 無法更改 GitHub 連線。",
  // The status next to the name at the top of the GitHub page.
  "connector.github.statusConnected": "已連線",
  "connector.github.statusConnecting": "連線中",
  "connector.github.statusExpired": "已過期",
  "connector.github.accountTitle": "帳號",
  // {count} is the number of repositories in the list, such as 12.
  "connector.github.filterPlaceholder": { one: "篩選 {count} 個倉庫", other: "篩選 {count} 個倉庫" },
  "connector.github.filterLabel": "篩選倉庫",
  // {query} is the text the user typed in the filter.
  "connector.github.noMatch": "沒有匹配「{query}」的倉庫。",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.github.stepSignIn": "登入",
  "connector.github.stepConnected": "已連線",
  "connector.github.requestingCode": "OpenBot 正在向 GitHub 請求驗證碼。",
  // {code} is the code to type on GitHub, such as WDJB-MJHT.
  "connector.github.codeLabel": "驗證碼 {code}",
  "connector.github.failedTitle": "GitHub 未連線成功",
  "connector.github.cancelConnecting": "取消連線 GitHub",
  // {count} is the number of repositories that agents can use.
  "connector.github.connectedSummary": {
    one: "{count} 個倉庫 · 這臺電腦上的所有助理",
    other: "{count} 個倉庫 · 這臺電腦上的所有助理",
  },
  "connector.github.done": "完成",
  "connector.github.later": "稍後",
  // The confirmation before Disconnect. {login} is the GitHub account name, such as octocat.
  "connector.github.disconnectConfirmTitle": "斷開 GitHub？",
  "connector.github.disconnectConfirmDescription": "斷開後會從這臺電腦移除 @{login} 的登入資訊。",
  "connector.github.disconnectEffectTools": "所有助理都將失去 GitHub 工具、gh 和 git。",
  "connector.github.disconnectEffectRevoke": "隨後會開啟 GitHub，你可以在那裡撤銷 OpenBot。",
  "connector.github.disconnectEffectKept": "聊天、檔案和助理記憶仍保留在這臺電腦上。",
  // The same text for the connection of a joined server. {host} is the server name, such as Studio.
  "connector.github.descriptionHost":
    "{host} 上的每個助理都可以使用你的 GitHub 倉庫、Issue 和拉取請求，以及 gh 和 git。",
  "connector.github.connectedSummaryHost": {
    one: "{count} 個倉庫 · {host} 上的所有助理",
    other: "{count} 個倉庫 · {host} 上的所有助理",
  },
  "connector.github.disconnectConfirmDescriptionHost": "斷開後會從 {host} 移除 @{login} 的登入資訊。",
  "connector.github.disconnectEffectKeptHost": "聊天、檔案和助理記憶仍保留在 {host} 上。",
  "connector.github.keepConnected": "保持連線",
  "connector.github.close": "關閉",
  // The last section of an integration page, with the action that removes it.
  "connector.dangerZone": "危險操作",

  "connector.statusUnknown": "未知",
  "connector.readFailed": "OpenBot 無法讀取該連線的狀態。",
  // Marketplace > Apps > Slack: a workspace installs the one OpenBot app, and the Slack
  // Orchestrator agent receives each request, asks the team and answers.
  "connector.slack.title": "Slack",
  "connector.slack.description": "人們在 Slack 中提及 @OpenBot 或給它發私信，Slack 排程助理會找到合適的助理來回答。",
  "connector.slack.statusConnected": "已連線",
  "connector.slack.statusAttention": "需要關注",
  // {workspace} is the Slack workspace name.
  "connector.slack.summaryConnected": "{workspace} · 由 Slack 排程助理回答",
  "connector.slack.summaryNoAgent": "{workspace} · 還沒有助理回答",
  "connector.slack.attentionTitle": {
    one: "{count} 個工作區需要關注",
    other: "{count} 個工作區需要關注",
  },
  "connector.slack.attentionDescription": "下方狀態說明了該怎麼做。",
  "connector.slack.connect": "連線 Slack",
  "connector.slack.addAgent": "新增助理",
  "connector.slack.actionFailed": "Slack 沒有接受該更改",
  "connector.slack.workspaceTitle": "工作區",
  "connector.slack.workspaceDescription": "人們提及 @OpenBot 或給它發私信。",
  "connector.slack.disconnectWorkspace": "斷開連線",
  "connector.slack.disconnectAllTitle": "斷開 Slack",
  "connector.slack.disconnectAllSummary": "所有工作區都將斷開，其他人無法再透過 @OpenBot 聯絡你的助理。",
  "connector.slack.disconnectAllSummaryOrchestrator": "所有工作區都將斷開，Slack 排程助理及其對話將從 OpenBot 中刪除。",
  "connector.slack.missingScopes": "OpenBot 在 Slack 中缺少這些權限：{scopes}。請斷開該工作區後重新連線。",
  "connector.slack.retryAt": "Slack 要求 OpenBot 等待，將於 {time} 重試。",
  "connector.slack.reconnect": "重新連線",
  "connector.slack.pause": "暫停",
  "connector.slack.resume": "恢復",
  // {action} is a button, such as Pause; {name} is the workspace name.
  "connector.slack.rowAction": "{action}：{name}",
  "connector.slack.orchestratorTitle": "Slack 排程助理",
  "connector.slack.orchestratorDescription":
    "該助理接收來自 Slack 的所有請求。簡單的問題它自己回答，其餘的交給合適的助理處理，並把答案發在話題中。",
  "connector.slack.orchestratorNone": "還沒有助理回答",
  "connector.slack.orchestratorNoneDescription": "請新增 Slack 排程助理，否則 Slack 中不會有人回答。",
  "connector.slack.inviteNote":
    "OpenBot 會自動加入每個公開頻道以及之後新建的公開頻道。私有頻道需要邀請：/invite @OpenBot。",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.slack.stepWorkspace": "工作區",
  "connector.slack.stepAgent": "助理",
  "connector.slack.connectTitle": "連線 Slack 工作區",
  "connector.slack.connectDescription": "OpenBot 會在該工作區安裝一個名為 OpenBot 的應用，並加入所有公開頻道。",
  "connector.slack.connectStepBrowser": "Slack 會在瀏覽器中開啟",
  "connector.slack.connectStepAllow": "在右上角選擇工作區，然後點「允許」",
  "connector.slack.connectStepReturn": "Slack 完成後該對話方塊會繼續",
  "connector.slack.connectInSlack": "在 Slack 中連線",
  "connector.slack.connectWaiting": "正在等待 Slack，請在瀏覽器中完成安裝。",
  "connector.slack.agentStepTitle": "新增 Slack 排程助理",
  // {workspace} is the Slack workspace name.
  "connector.slack.agentStepDescription": "這個新助理會回答人們在 {workspace} 中發給 @OpenBot 的所有內容。",
  "connector.slack.orchestratorName": "Slack 排程助理",
  "connector.slack.orchestratorRole": "在 Slack 中回答並排程團隊",
  "connector.slack.orchestratorDoesReceive": "優先接收所有 Slack 請求",
  "connector.slack.orchestratorDoesDelegate": "把每項任務交給最合適的助理",
  "connector.slack.orchestratorDoesAnswer": "把答案發到 Slack 話題中",
  "connector.slack.orchestratorModel": "模型",
  "connector.slack.doneTitle": "OpenBot 已加入 {workspace}",
  "connector.slack.doneDescription": "在任意公開頻道中提及 @OpenBot，或給它發私信。",
  "connector.slack.done": "完成",
  "connector.slack.disconnectTitle": "斷開 {workspace}？",
  "connector.slack.disconnectDescription": "OpenBot 將停止在 {workspace} 中回答，並從這臺電腦刪除其 Slack 權杖。",
  "connector.slack.disconnectDescriptionHost": "OpenBot 將停止在 {workspace} 中回答，並從 {host} 刪除其 Slack 權杖。",
  "connector.slack.disconnectEffect": "{workspace} 中的人將無法再透過 @OpenBot 聯絡你的助理。",
  "connector.slack.removeEffectKept": "對話和 Slack 排程助理會保留在 OpenBot 中。",
  "connector.slack.removeEffectDeleted": "Slack 排程助理及其對話將從 OpenBot 中刪除。",
  "connector.slack.keep": "保持連線",
  "connector.slack.close": "關閉",

  "connector.slack.addWorkspace": "新增工作區",
  // Shown when the page has the maximum number of workspaces.
  "connector.slack.limitReached": { other: "最多可連線 {count} 個工作區。" },
  // {count} is the number of Slack workspaces: two or more.
  "connector.slack.summaryMany": { other: "{count} 個工作區 · 由 Slack 排程助理回答" },
  // Marketplace > Apps > Discord: a Discord server (a guild) adds the one OpenBot bot, and
  // the Discord Orchestrator agent receives each request, asks the team and answers. Always write
  // "Discord server": "server" alone is an OpenBot server.
  "connector.discord.title": "Discord",
  "connector.discord.description":
    "人們在 Discord 伺服器的頻道中提及 @OpenBot，Discord 排程助理會找到合適的助理來回答。",
  "connector.discord.statusConnected": "已連線",
  "connector.discord.statusAttention": "需要關注",
  // {workspace} is the Discord server name.
  "connector.discord.summaryConnected": "{workspace} · 由 Discord 排程助理回答",
  "connector.discord.summaryNoAgent": "{workspace} · 還沒有助理回答",
  "connector.discord.attentionTitle": {
    one: "{count} 個 Discord 伺服器需要關注",
    other: "{count} 個 Discord 伺服器需要關注",
  },
  "connector.discord.attentionDescription": "下方狀態說明了該怎麼做。",
  "connector.discord.connect": "連線 Discord",
  "connector.discord.addAgent": "新增助理",
  "connector.discord.actionFailed": "Discord 沒有接受該更改",
  "connector.discord.workspaceTitle": "Discord 伺服器",
  "connector.discord.workspaceDescription": "在頻道中提及 @OpenBot，回覆 OpenBot 可繼續對話。",
  "connector.discord.disconnectWorkspace": "斷開連線",
  "connector.discord.disconnectAllTitle": "斷開 Discord",
  "connector.discord.disconnectAllSummary": "所有伺服器都將斷開，其他人無法再透過 @OpenBot 聯絡你的助理。",
  "connector.discord.disconnectAllSummaryOrchestrator":
    "所有伺服器都將斷開，Discord 排程助理及其對話將從 OpenBot 中刪除。",
  "connector.discord.missingScopes": "OpenBot 在 Discord 中缺少這些權限：{scopes}。請斷開該 Discord 伺服器後重新連線。",
  "connector.discord.retryAt": "Discord 要求 OpenBot 等待，將於 {time} 重試。",
  "connector.discord.reconnect": "重新連線",
  "connector.discord.pause": "暫停",
  "connector.discord.resume": "恢復",
  // {action} is a button, such as Pause; {name} is the Discord server name.
  "connector.discord.rowAction": "{action}：{name}",
  "connector.discord.orchestratorTitle": "Discord 排程助理",
  "connector.discord.orchestratorDescription":
    "該助理接收來自 Discord 的所有請求。簡單的問題它自己回答，其餘的交給合適的助理處理，並在頻道中回覆答案。",
  "connector.discord.orchestratorNone": "還沒有助理回答",
  "connector.discord.orchestratorNoneDescription": "請新增 Discord 排程助理，否則 Discord 中不會有人回答。",
  "connector.discord.channelsNote": "OpenBot 能看到其角色可見的頻道。",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.discord.stepWorkspace": "Discord 伺服器",
  "connector.discord.stepAgent": "助理",
  "connector.discord.connectTitle": "連線 Discord 伺服器",
  "connector.discord.connectDescription": "OpenBot 會向該 Discord 伺服器新增一個名為 OpenBot 的機器人。",
  "connector.discord.connectStepBrowser": "Discord 會在瀏覽器中開啟",
  "connector.discord.connectStepAllow": "選擇伺服器，然後點「授權」",
  "connector.discord.connectStepReturn": "Discord 完成後該對話方塊會繼續",
  "connector.discord.connectInDiscord": "在 Discord 中連線",
  "connector.discord.connectWaiting": "正在等待 Discord，請在瀏覽器中完成授權。",
  "connector.discord.agentStepTitle": "新增 Discord 排程助理",
  // {workspace} is the Discord server name.
  "connector.discord.agentStepDescription": "這個新助理會回答人們在 {workspace} 中發給 @OpenBot 的所有內容。",
  "connector.discord.orchestratorName": "Discord 排程助理",
  "connector.discord.orchestratorRole": "在 Discord 中回答並排程團隊",
  "connector.discord.orchestratorDoesReceive": "優先接收所有 Discord 請求",
  "connector.discord.orchestratorDoesDelegate": "把每項任務交給最合適的助理",
  "connector.discord.orchestratorDoesAnswer": "在 Discord 頻道中回覆答案",
  "connector.discord.orchestratorModel": "模型",
  "connector.discord.doneTitle": "OpenBot 已加入 {workspace}",
  "connector.discord.doneDescription": "在頻道中提及 @OpenBot，回覆 OpenBot 可繼續對話。",
  "connector.discord.done": "完成",
  "connector.discord.disconnectTitle": "斷開 {workspace}？",
  "connector.discord.disconnectDescription": "OpenBot 將停止在 {workspace} 中回答，並從這臺電腦移除 Discord 連線。",
  "connector.discord.disconnectDescriptionHost": "OpenBot 將停止在 {workspace} 中回答，並從 {host} 移除 Discord 連線。",
  "connector.discord.disconnectEffect": "{workspace} 中的人將無法再透過 @OpenBot 聯絡你的助理。",
  "connector.discord.removeEffectKept": "對話和 Discord 排程助理會保留在 OpenBot 中。",
  "connector.discord.removeEffectDeleted": "Discord 排程助理及其對話將從 OpenBot 中刪除。",
  "connector.discord.keep": "保持連線",
  "connector.discord.close": "關閉",

  "connector.discord.addWorkspace": "新增 Discord 伺服器",
  "connector.discord.limitReached": { other: "最多可連線 {count} 個 Discord 伺服器。" },
  // {count} is the number of Discord servers: two or more.
  "connector.discord.summaryMany": { other: "{count} 個 Discord 伺服器 · 由 Discord 排程助理回答" },
  // Who can use OpenBot in one Discord server: the members with one of the chosen Discord roles.
  "connector.discord.accessTitle": "誰可以使用 OpenBot",
  "connector.discord.accessDescription": "OpenBot 只回答這些人。其他人的提及會被忽略。",
  "connector.discord.accessEveryone": "伺服器中的所有人",
  "connector.discord.accessEveryoneDescription": "凡是能在 OpenBot 可見的頻道中發訊息的人，都可以提及它。",
  // {roles} is a list of Discord role names, such as "Admin and Moderator".
  "connector.discord.accessRoles": "擁有 {roles} 的成員",
  "connector.discord.accessChoose": "選擇角色",
  // {workspace} is the Discord server name.
  "connector.discord.accessDialogTitle": "誰可以在 {workspace} 中使用 OpenBot？",
  "connector.discord.accessDialogDescription": "不選擇任何角色時，所有人都可以提及 OpenBot。",
  "connector.discord.accessLoading": "正在載入角色…",
  "connector.discord.accessLoadFailed": "Discord 角色未能載入",
  "connector.discord.accessNoRoles": "該伺服器沒有可選的角色。",
  // {role} is the name of a Discord role that the server no longer has.
  "connector.discord.accessRoleDeleted": "{role}（已刪除）",
  "connector.discord.accessSave": "儲存",
  // {host} is the joined server's name.
  "connector.discord.accessHostUpdate": "請更新 {host} 上的 OpenBot，以選擇角色。",
  // Marketplace > Apps > Telegram: each chat adds the one OpenBot bot, and the Telegram
  // Orchestrator agent receives the messages of all chats, asks the team and answers.
  "connector.telegram.title": "Telegram",
  "connector.telegram.description":
    "把 OpenBot 機器人加入 Telegram 群組，或與它開啟私聊。Telegram 排程助理會找到合適的助理來回答。",
  "connector.telegram.statusConnected": "已連線",
  "connector.telegram.statusAttention": "需要關注",
  // {count} is the number of linked Telegram chats.
  "connector.telegram.summaryConnected": {
    one: "{count} 個聊天 · 由 Telegram 排程助理回答",
    other: "{count} 個聊天 · 由 Telegram 排程助理回答",
  },
  "connector.telegram.summaryNoAgent": {
    one: "{count} 個聊天 · 還沒有助理回答",
    other: "{count} 個聊天 · 還沒有助理回答",
  },
  "connector.telegram.attentionTitle": {
    one: "{count} 個聊天需要關注",
    other: "{count} 個聊天需要關注",
  },
  "connector.telegram.attentionDescription": "下方狀態說明了該怎麼做。",
  "connector.telegram.connect": "連線 Telegram",
  "connector.telegram.addAgent": "新增助理",
  "connector.telegram.actionFailed": "Telegram 沒有接受該更改",
  "connector.telegram.chatsTitle": "聊天",
  "connector.telegram.groupDescription": "人們提及機器人或回覆它的訊息。",
  "connector.telegram.directDescription": "該聊天中的所有訊息都會交給 Telegram 排程助理。",
  "connector.telegram.helpRemoved": "OpenBot 機器人已不在該聊天中。請斷開該聊天，然後重新新增機器人。",
  "connector.telegram.helpRelayUnavailable":
    "OpenBot 無法在這臺電腦上接收 Telegram 訊息。請先登入，在伺服器設定中為這臺電腦命名，並保持 OpenBot 開著。",
  "connector.telegram.helpRelayUnavailableHost":
    "{host} 上的 OpenBot 無法接收 Telegram 訊息。請在 {host} 上登入，在伺服器設定中為該伺服器命名，並保持 OpenBot 開著。",
  "connector.telegram.helpError": "OpenBot 無法連線到該聊天。請重新連線，或斷開該聊天。",
  "connector.telegram.retryAt": "Telegram 要求 OpenBot 等待，將於 {time} 重試。",
  "connector.telegram.pause": "暫停",
  "connector.telegram.resume": "恢復",
  "connector.telegram.reconnect": "重新連線",
  "connector.telegram.disconnectChat": "斷開連線",
  "connector.telegram.disconnectAllTitle": "斷開 Telegram",
  "connector.telegram.disconnectAllSummary": "所有聊天都將斷開，其他人無法再透過 OpenBot 機器人聯絡你的助理。",
  "connector.telegram.disconnectAllSummaryOrchestrator":
    "所有聊天都將斷開，Telegram 排程助理及其對話將從 OpenBot 中刪除。",
  // {action} is a button, such as Pause; {name} is the chat name.
  "connector.telegram.rowAction": "{action}：{name}",
  "connector.telegram.linkChat": "關聯聊天",
  "connector.telegram.addToGroup": "加入群組",
  "connector.telegram.openDirectChat": "開啟私聊",
  "connector.telegram.orchestratorTitle": "Telegram 排程助理",
  "connector.telegram.orchestratorDescription":
    "該助理接收來自你所有 Telegram 聊天中發給 OpenBot 的訊息。簡單的問題它自己回答，其餘的交給合適的助理處理，並把答案發在聊天中。",
  "connector.telegram.orchestratorNone": "還沒有助理回答",
  "connector.telegram.orchestratorNoneDescription": "請新增 Telegram 排程助理，否則 Telegram 中不會有人回答。",
  "connector.telegram.mentionNote": "在群組中請提及機器人或回覆它的訊息；在私聊中所有訊息都會發給機器人。",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.telegram.stepChat": "聊天",
  "connector.telegram.stepAgent": "助理",
  "connector.telegram.connectTitle": "關聯 Telegram 聊天",
  "connector.telegram.connectDescription":
    "把 OpenBot 機器人加入群組，或與它開啟私聊。一個機器人即可服務你的所有聊天。",
  "connector.telegram.connectStepBrowser": "Telegram 會在瀏覽器中開啟",
  "connector.telegram.connectStepPick": "選擇群組，或在私聊中點選「開始」",
  "connector.telegram.connectStepReturn": "聊天關聯完成後該對話方塊會繼續",
  "connector.telegram.connectWaiting": "正在等待 Telegram，請在 Telegram 中選擇聊天。",
  "connector.telegram.agentStepTitle": "新增 Telegram 排程助理",
  // {chat} is the Telegram chat name.
  "connector.telegram.agentStepDescription":
    "這個新助理會回答 {chat} 中以及你之後關聯的每個聊天中發給 OpenBot 的訊息。",
  "connector.telegram.orchestratorName": "Telegram 排程助理",
  "connector.telegram.orchestratorRole": "在 Telegram 中回答並排程團隊",
  "connector.telegram.orchestratorDoesReceive": "優先接收所有發給 OpenBot 的 Telegram 訊息",
  "connector.telegram.orchestratorDoesDelegate": "把每項任務交給最合適的助理",
  "connector.telegram.orchestratorDoesAnswer": "把答案發到 Telegram 聊天中",
  "connector.telegram.orchestratorModel": "模型",
  "connector.telegram.doneTitle": "OpenBot 已加入 {chat}",
  "connector.telegram.done": "完成",
  "connector.telegram.disconnectTitle": "斷開 {chat}？",
  "connector.telegram.leaveDescription": "OpenBot 機器人會退出 {chat}，OpenBot 將停止在那裡回答。",
  "connector.telegram.disconnectEffect": "{chat} 中的人將無法再透過 OpenBot 機器人聯絡你的助理。",
  "connector.telegram.removeEffectKept": "對話和 Telegram 排程助理會保留在 OpenBot 中。",
  "connector.telegram.removeEffectDeleted": "這是最後一個聊天，因此 Telegram 排程助理及其對話將從 OpenBot 中刪除。",
  "connector.telegram.keep": "保持連線",
  "connector.telegram.close": "關閉",
  // Marketplace > 1Password: a vault that the user shares with OpenBot through a service account.
  "connector.onePassword.title": "1Password",
  "connector.onePassword.description":
    "透過服務帳號把一個專用的 1Password 保險庫共享給 OpenBot，讓助理可以在 OpenBot 瀏覽器中登入網站。",
  "connector.onePassword.howItWorks":
    "連線時會在你的 1Password 帳號中建立「Shared with OpenBot」保險庫，以及一個只能讀取該保險庫的服務帳號。OpenBot 在這臺電腦的瀏覽器中填充已儲存的登入資訊，因此只會共享你移入該保險庫的條目。助理永遠看不到密碼。",
  "connector.onePassword.connect": "連線 1Password",
  // The three setup steps before a connection, each with the one button it needs.
  "connector.onePassword.setupTitle": "設定",
  "connector.onePassword.stepCliTitle": "安裝 1Password CLI",
  "connector.onePassword.stepCliChecking": "正在這臺電腦上查詢 1Password CLI",
  "connector.onePassword.stepCliInstalling": "正在從 1Password 下載 1Password CLI",
  // {version} is a version number, such as 2.39.0.
  "connector.onePassword.stepCliReady": "已安裝版本 {version}。",
  "connector.onePassword.stepCliMissing": "OpenBot 會從 1Password 下載到自己的資料夾，不需要管理員密碼。",
  "connector.onePassword.stepCliManual": "OpenBot 無法在這臺電腦上安裝它。請從 1Password 安裝後再回到該頁面。",
  "connector.onePassword.installCli": "安裝",
  "connector.onePassword.stepAppTitle": "開啟 CLI 整合",
  "connector.onePassword.stepAppDescription":
    "在 1Password 應用中開啟「設定 > 開發者」，開啟「與 1Password CLI 整合」。",
  "connector.onePassword.stepAppReady": "1Password 應用已允許 CLI 建立共享保險庫。",
  "connector.onePassword.openApp": "開啟 1Password",
  "connector.onePassword.openAppFailed": "OpenBot 無法開啟 1Password。",
  "connector.onePassword.checkAgain": "重新檢查",
  "connector.onePassword.stepVaultTitle": "建立共享保險庫",
  "connector.onePassword.stepVaultDescription":
    "OpenBot 會建立「Shared with OpenBot」保險庫和一個只能讀取它的服務帳號。1Password 會請求你批准。",
  "connector.onePassword.useTokenDescription": "不走這些步驟，改為貼上 1Password.com 上的服務帳號權杖。",
  "connector.onePassword.useTokenAction": "使用權杖",
  "connector.onePassword.tokenLabel": "服務帳號權杖",
  "connector.onePassword.tokenPlaceholder": "ops_…",
  "connector.onePassword.connectWithToken": "連線",
  "connector.onePassword.approveInApp": "請在 1Password 應用中批准該請求",
  "connector.onePassword.cancel": "取消",
  "connector.onePassword.chooseAccountTitle": "選擇帳號",
  "connector.onePassword.chooseAccountDescription": "OpenBot 會在你選擇的帳號中建立共享保險庫。",
  "connector.onePassword.useAccount": "使用該帳號",
  "connector.onePassword.vaultTitle": "共享保險庫",
  "connector.onePassword.vaultDescription": "在 1Password 中把登入資訊移入該保險庫，助理即可用它登入。移出後即停止。",
  "connector.onePassword.loginsLoading": "正在從 1Password 讀取登入資訊",
  // {count} is a number, such as 3.
  "connector.onePassword.loginCount": { one: "{count} 條登入資訊", other: "{count} 條登入資訊" },
  "connector.onePassword.disconnect": "斷開連線",
  "connector.onePassword.disconnectTitle": "斷開 1Password",
  "connector.onePassword.disconnectSummary":
    "OpenBot 會忘記該權杖。保險庫和服務帳號仍保留在 1Password 中，如不再需要請在那裡刪除。",
  "connector.onePassword.actionFailed": "OpenBot 無法更改 1Password 連線。",
  "connector.onePassword.statusConnected": "已連線",
  "connector.onePassword.statusConnecting": "連線中",
  // The same page for the connection of a joined server. {host} is the server name, such as Studio.
  "connector.onePassword.descriptionHost":
    "透過服務帳號把一個專用的 1Password 保險庫共享給 {host} 上的 OpenBot，讓 {host} 上的助理可以在其瀏覽器中登入網站。",
  "connector.onePassword.howItWorksHost":
    "{host} 使用服務帳號權杖連線。請在 1Password.com 上建立一個只能讀取你共享給 OpenBot 的保險庫的服務帳號，然後把它的權杖貼上到這裡。{host} 會校驗並儲存該權杖，這臺電腦不儲存。助理永遠看不到密碼。",
  "connector.onePassword.disconnectSummaryHost":
    "{host} 會忘記該權杖。保險庫和服務帳號仍保留在 1Password 中，如不再需要請在那裡刪除。",
  "connector.bitwarden.title": "Bitwarden",
  "connector.bitwarden.description": "用 Bitwarden 填充瀏覽器登入資訊。",
  "connector.bitwarden.setup":
    "請安裝 Bitwarden CLI 並用 bw login 登入。建立一個名為 Shared with OpenBot 的資料夾，只把允許助理使用的登入資訊放進去。執行 bw unlock --raw，把工作階段金鑰貼上到下方。請勿貼上主密碼。",
  "connector.bitwarden.scope":
    "這臺電腦上的所有助理都可以使用 Shared with OpenBot 中匹配的登入資訊。OpenBot 只按精確的 HTTPS 來源匹配，不會使用需要主密碼提示或自定義 URI 匹配規則的條目。",
  "connector.bitwarden.session":
    "工作階段金鑰只儲存在記憶體中。連續 8 小時未使用保險庫或 OpenBot 退出後，需要重新連線。斷開只停止 OpenBot 的訪問，不會鎖定其他 Bitwarden 客戶端。",
  "connector.bitwarden.sessionKey": "Bitwarden 工作階段金鑰",
  "connector.bitwarden.connect": "連線 Bitwarden",
  "connector.bitwarden.disconnect": "斷開 Bitwarden",
  "connector.bitwarden.disconnectAction": "斷開",
  "connector.bitwarden.disconnectSummary":
    "OpenBot 會忘記工作階段金鑰。代理將無法再從 Bitwarden 填寫登入資訊。其他 Bitwarden 客戶端保持解鎖狀態。",
  "connector.bitwarden.disconnectSummaryHost":
    "{host} 會刪除 API 金鑰和主密碼。{host} 上的代理將無法再從 Bitwarden 填寫登入資訊。",
  "connector.bitwarden.connected": "已連線",
  "connector.bitwarden.actionFailed": "OpenBot 無法更改 Bitwarden 連線。",
  "connector.bitwarden.descriptionHost": "在 {host} 上用 Bitwarden 或 Vaultwarden 填充瀏覽器登入資訊。",
  "connector.bitwarden.setupHost":
    "{host} 使用自己的 Bitwarden CLI 登入。請在你的保險庫中建立一個名為 Shared with OpenBot 的資料夾，只把允許助理使用的登入資訊放進去。在網頁版保險庫中開啟「設定 › 安全 › 金鑰」，檢視你的 API 金鑰。然後在下方填寫伺服器地址、client_id、client_secret 和你的主密碼。",
  "connector.bitwarden.scopeHost":
    "{host} 上的所有助理都可以使用 Shared with OpenBot 中匹配的登入資訊。OpenBot 只按精確的 HTTPS 來源匹配，不會使用需要主密碼提示或自定義 URI 匹配規則的條目。",
  "connector.bitwarden.sessionHost":
    "{host} 會加密儲存 API 金鑰和主密碼，因此重啟後可以再次解鎖。這臺電腦不儲存它們。斷開連線會把它們從 {host} 上移除。{host} 必須能透過 HTTPS 訪問該伺服器地址。",
  "connector.bitwarden.serverUrl": "伺服器地址",
  "connector.bitwarden.folderTitle": "共享資料夾",
  "connector.bitwarden.folderDescription": "在 Bitwarden 中把登入資訊移入該資料夾，助理即可用它登入。移出後即停止。",
  "connector.bitwarden.folderName": "Shared with OpenBot",
  "connector.bitwarden.folderKind": "Bitwarden 中的資料夾",
  "connector.bitwarden.clientId": "API 金鑰 client_id",
  "connector.bitwarden.clientSecret": "API 金鑰 client_secret",
  "connector.bitwarden.masterPassword": "主密碼",
  "connector.bitwarden.connecting": "正在連線",
} as const satisfies PartialTranslation<typeof source>;
