import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/connector";

export const messages = {
  // Marketplace > Apps > GitHub: the built-in GitHub connection.
  "connector.github.title": "GitHub",
  "connector.github.description":
    "כל סוכן במחשב הזה יכול להשתמש במאגרי GitHub, בבעיות ובבקשות המשיכה שלך, וב-gh וב-git.",
  "connector.github.connect": "חיבור GitHub",
  "connector.github.pendingTitle": "יש להקליד את הקוד הזה ב-GitHub",
  "connector.github.pendingDescription": "GitHub נפתח בדפדפן. יש להקליד שם את הקוד כדי להתחבר.",
  "connector.github.waiting": "ממתין ל-GitHub",
  "connector.github.copyCode": "העתקת הקוד",
  "connector.github.codeCopied": "הועתק",
  "connector.github.openGitHub": "פתיחת GitHub",
  "connector.github.cancel": "ביטול",
  "connector.github.connectedAs": "מחובר בתור @{login}",
  "connector.github.repositoriesTitle": "מאגרים",
  "connector.github.repositoriesDescription":
    "סוכנים יכולים להשתמש רק במאגרים שבהם מותקנת אפליקציית OpenBot GitHub App.",
  "connector.github.chooseRepositories": "בחירת מאגרים",
  "connector.github.repositoriesLoading": "קורא את המאגרים מ-GitHub",
  "connector.github.repositoriesFailed": "OpenBot לא הצליח לקרוא את המאגרים מ-GitHub.",
  "connector.github.noRepositories": "אפליקציית OpenBot GitHub App עדיין לא מותקנת באף מאגר.",
  // {count} is a number, such as 12.
  "connector.github.moreRepositories": { one: "ועוד מאגר אחד", two: "ועוד שני מאגרים", other: "ועוד {count} מאגרים" },
  // A badge next to a repository that only its members can see.
  "connector.github.private": "פרטי",
  "connector.github.disconnect": "ניתוק",
  "connector.github.disconnectTitle": "ניתוק GitHub",
  "connector.github.disconnectSummary": "כל סוכן מאבד את הגישה ל-GitHub. הצ'אטים והקבצים שלך נשארים.",
  "connector.github.expiredTitle": "החיבור ל-GitHub פג תוקף",
  "connector.github.expiredDescription": "יש להתחבר שוב בתור @{login} כדי לתת לסוכנים גישה ל-GitHub מחדש.",
  "connector.github.reconnect": "חיבור מחדש",
  "connector.github.actionFailed": "OpenBot לא הצליח לשנות את החיבור ל-GitHub.",
  // The status next to the name at the top of the GitHub page.
  "connector.github.statusConnected": "מחובר",
  "connector.github.statusConnecting": "מתחבר",
  "connector.github.statusExpired": "פג תוקף",
  "connector.github.accountTitle": "חשבון",
  // {count} is the number of repositories in the list, such as 12.
  "connector.github.filterPlaceholder": {
    one: "סינון מאגר אחד",
    two: "סינון שני מאגרים",
    other: "סינון {count} מאגרים",
  },
  "connector.github.filterLabel": "סינון מאגרים",
  // {query} is the text the user typed in the filter.
  "connector.github.noMatch": "אין מאגר שמתאים ל-״{query}״.",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.github.stepSignIn": "התחברות",
  "connector.github.stepConnected": "מחובר",
  "connector.github.requestingCode": "OpenBot מבקש קוד מ-GitHub.",
  // {code} is the code to type on GitHub, such as WDJB-MJHT.
  "connector.github.codeLabel": "קוד {code}",
  "connector.github.failedTitle": "החיבור ל-GitHub נכשל",
  "connector.github.cancelConnecting": "ביטול החיבור ל-GitHub",
  // {count} is the number of repositories that agents can use.
  "connector.github.connectedSummary": {
    one: "מאגר אחד · כל סוכן במחשב הזה",
    two: "שני מאגרים · כל סוכן במחשב הזה",
    other: "{count} מאגרים · כל סוכן במחשב הזה",
  },
  "connector.github.done": "סיום",
  "connector.github.later": "מאוחר יותר",
  // The confirmation before Disconnect. {login} is the GitHub account name, such as octocat.
  "connector.github.disconnectConfirmTitle": "לנתק את GitHub?",
  "connector.github.disconnectConfirmDescription": "הניתוק מסיר את ההתחברות של @{login} מהמחשב הזה.",
  "connector.github.disconnectEffectTools": "כל סוכן מאבד את הכלים של GitHub, את gh ואת git.",
  "connector.github.disconnectEffectRevoke": "לאחר מכן GitHub נפתח, ושם אפשר לבטל את הגישה של OpenBot.",
  "connector.github.disconnectEffectKept": "הצ'אטים, הקבצים והזיכרון של הסוכנים נשארים במחשב הזה.",
  // The same text for the connection of a joined server. {host} is the server name, such as Studio.
  "connector.github.descriptionHost":
    "כל סוכן ב-{host} יכול להשתמש במאגרי GitHub, בבעיות ובבקשות המשיכה שלך, וב-gh וב-git.",
  "connector.github.connectedSummaryHost": {
    one: "מאגר אחד · כל סוכן ב-{host}",
    two: "שני מאגרים · כל סוכן ב-{host}",
    other: "{count} מאגרים · כל סוכן ב-{host}",
  },
  "connector.github.disconnectConfirmDescriptionHost": "הניתוק מסיר את ההתחברות של @{login} מ-{host}.",
  "connector.github.disconnectEffectKeptHost": "הצ'אטים, הקבצים והזיכרון של הסוכנים נשארים ב-{host}.",
  "connector.github.keepConnected": "השארת החיבור",
  "connector.github.close": "סגירה",
  // The last section of an integration page, with the action that removes it.
  "connector.dangerZone": "אזור מסוכן",
  "connector.statusUnknown": "לא ידוע",
  "connector.readFailed": "OpenBot לא הצליח לקרוא את מצב החיבור הזה.",

  // Marketplace > Apps > Slack: a workspace installs the one OpenBot app, and the Slack
  // Orchestrator agent receives each request, asks the team and answers.
  "connector.slack.title": "Slack",
  "connector.slack.description":
    "אפשר לתייג את @OpenBot ב-Slack או לשלוח לו הודעה ישירה. מתזמר Slack פונה לסוכן המתאים ועונה.",
  "connector.slack.statusConnected": "מחובר",
  "connector.slack.statusAttention": "דורש תשומת לב",
  // {workspace} is the Slack workspace name.
  "connector.slack.summaryConnected": "{workspace} · מתזמר Slack עונה",
  "connector.slack.summaryNoAgent": "{workspace} · אין עדיין סוכן שעונה",
  "connector.slack.attentionTitle": {
    one: "סביבת עבודה אחת דורשת תשומת לב",
    two: "שתי סביבות עבודה דורשות תשומת לב",
    other: "{count} סביבות עבודה דורשות תשומת לב",
  },
  "connector.slack.attentionDescription": "הסטטוס שמוצג למטה מסביר מה לעשות.",
  "connector.slack.connect": "חיבור Slack",
  "connector.slack.addAgent": "הוספת סוכן",
  "connector.slack.actionFailed": "Slack לא קיבל את השינוי",
  "connector.slack.workspaceTitle": "סביבות עבודה",
  "connector.slack.workspaceDescription": "אפשר לתייג את @OpenBot או לשלוח לו הודעה ישירה.",
  "connector.slack.disconnectWorkspace": "ניתוק",
  "connector.slack.disconnectAllTitle": "ניתוק Slack",
  "connector.slack.disconnectAllSummary": "כל סביבות העבודה מתנתקות. אי אפשר עוד להגיע לסוכנים שלך דרך @OpenBot.",
  "connector.slack.disconnectAllSummaryOrchestrator":
    "כל סביבות העבודה מתנתקות. מתזמר Slack והשיחות שלו נמחקים מ-OpenBot.",
  "connector.slack.missingScopes":
    "אין ל-OpenBot את ההרשאות האלה ב-Slack: {scopes}. יש לנתק את סביבת העבודה ולחבר אותה שוב.",
  "connector.slack.retryAt": "Slack ביקש מ-OpenBot להמתין. הוא ינסה שוב ב-{time}.",
  "connector.slack.reconnect": "חיבור מחדש",
  "connector.slack.pause": "השהיה",
  "connector.slack.resume": "המשך",
  // {action} is a button, such as Pause; {name} is the workspace name.
  "connector.slack.rowAction": "{action}: {name}",
  "connector.slack.orchestratorTitle": "מתזמר Slack",
  "connector.slack.orchestratorDescription":
    "הסוכן הזה מקבל כל בקשה מ-Slack. הוא עונה בעצמו על בקשות קצרות, מעביר עבודה אחרת לסוכן המתאים ומפרסם את התשובה בשרשור.",
  "connector.slack.orchestratorNone": "אין עדיין סוכן שעונה",
  "connector.slack.orchestratorNoneDescription": "יש להוסיף את מתזמר Slack, אחרת Slack לא יקבל תשובה.",
  "connector.slack.inviteNote":
    "OpenBot מצטרף בעצמו לכל ערוץ ציבורי, וגם לכל ערוץ חדש. לערוץ פרטי יש להזמין אותו: /invite @OpenBot.",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.slack.stepWorkspace": "סביבת עבודה",
  "connector.slack.stepAgent": "סוכן",
  "connector.slack.connectTitle": "חיבור סביבת עבודה של Slack",
  "connector.slack.connectDescription":
    "OpenBot מתקין אפליקציה אחת בסביבת העבודה, בשם OpenBot, והיא מצטרפת לכל ערוץ ציבורי.",
  "connector.slack.connectStepBrowser": "Slack נפתח בדפדפן",
  "connector.slack.connectStepAllow": "יש לבחור את סביבת העבודה בפינה הימנית העליונה ואז באפשר (Allow)",
  "connector.slack.connectStepReturn": "החלון הזה ממשיך כש-Slack מסיים",
  "connector.slack.connectInSlack": "חיבור ב-Slack",
  "connector.slack.connectWaiting": "ממתין ל-Slack. יש לסיים את ההתקנה בדפדפן.",
  "connector.slack.agentStepTitle": "הוספת מתזמר Slack",
  // {workspace} is the Slack workspace name.
  "connector.slack.agentStepDescription": "הסוכן החדש הזה עונה על כל מה שנשלח אל @OpenBot ב-{workspace}.",
  "connector.slack.orchestratorName": "מתזמר Slack",
  "connector.slack.orchestratorRole": "עונה ב-Slack ופונה לצוות",
  "connector.slack.orchestratorDoesReceive": "מקבל קודם כל בקשה מ-Slack",
  "connector.slack.orchestratorDoesDelegate": "מעביר כל משימה לסוכן המתאים ביותר",
  "connector.slack.orchestratorDoesAnswer": "מפרסם את התשובה בשרשור ב-Slack",
  "connector.slack.orchestratorModel": "מודל",
  "connector.slack.doneTitle": "OpenBot נמצא ב-{workspace}",
  "connector.slack.doneDescription": "אפשר לתייג את @OpenBot בכל ערוץ ציבורי או לשלוח לו הודעה ישירה.",
  "connector.slack.done": "סיום",
  "connector.slack.disconnectTitle": "לנתק את {workspace}?",
  "connector.slack.disconnectDescription": "OpenBot מפסיק לענות ב-{workspace} ומסיר את אסימון Slack שלו מהמחשב הזה.",
  "connector.slack.disconnectDescriptionHost": "OpenBot מפסיק לענות ב-{workspace} ומסיר את אסימון Slack שלו מ-{host}.",
  "connector.slack.disconnectEffect": "אנשים ב-{workspace} לא יוכלו עוד להגיע לסוכנים שלך דרך @OpenBot.",
  "connector.slack.removeEffectKept": "השיחות ומתזמר Slack נשארים ב-OpenBot.",
  "connector.slack.removeEffectDeleted": "מתזמר Slack והשיחות שלו נמחקים מ-OpenBot.",
  "connector.slack.keep": "השארת החיבור",
  "connector.slack.close": "סגירה",
  "connector.slack.addWorkspace": "הוספת סביבת עבודה",
  // Shown when the page has the maximum number of workspaces.
  "connector.slack.limitReached": {
    one: "אפשר לחבר סביבת עבודה אחת לכל היותר.",
    two: "אפשר לחבר שתי סביבות עבודה לכל היותר.",
    other: "אפשר לחבר {count} סביבות עבודה לכל היותר.",
  },
  // {count} is the number of Slack workspaces: two or more.
  "connector.slack.summaryMany": {
    one: "סביבת עבודה אחת · מתזמר Slack עונה",
    two: "שתי סביבות עבודה · מתזמר Slack עונה",
    other: "{count} סביבות עבודה · מתזמר Slack עונה",
  },

  // Marketplace > Apps > Discord: a Discord server (a guild) adds the one OpenBot bot, and
  // the Discord Orchestrator agent receives each request, asks the team and answers. Always write
  // "Discord server": "server" alone is an OpenBot server.
  "connector.discord.title": "Discord",
  "connector.discord.description":
    "אפשר לתייג את @OpenBot בערוץ של שרת Discord. מתזמר Discord פונה לסוכן המתאים ועונה.",
  "connector.discord.statusConnected": "מחובר",
  "connector.discord.statusAttention": "דורש תשומת לב",
  // {workspace} is the Discord server name.
  "connector.discord.summaryConnected": "{workspace} · מתזמר Discord עונה",
  "connector.discord.summaryNoAgent": "{workspace} · אין עדיין סוכן שעונה",
  "connector.discord.attentionTitle": {
    one: "שרת Discord אחד דורש תשומת לב",
    two: "שני שרתי Discord דורשים תשומת לב",
    other: "{count} שרתי Discord דורשים תשומת לב",
  },
  "connector.discord.attentionDescription": "הסטטוס שמוצג למטה מסביר מה לעשות.",
  "connector.discord.connect": "חיבור Discord",
  "connector.discord.addAgent": "הוספת סוכן",
  "connector.discord.actionFailed": "Discord לא קיבל את השינוי",
  "connector.discord.workspaceTitle": "שרתי Discord",
  "connector.discord.workspaceDescription": "אפשר לתייג את @OpenBot בערוץ. כדי להמשיך יש להשיב ל-OpenBot.",
  "connector.discord.disconnectWorkspace": "ניתוק",
  "connector.discord.disconnectAllTitle": "ניתוק Discord",
  "connector.discord.disconnectAllSummary": "כל השרתים מתנתקים. אי אפשר עוד להגיע לסוכנים שלך דרך @OpenBot.",
  "connector.discord.disconnectAllSummaryOrchestrator":
    "כל השרתים מתנתקים. מתזמר Discord והשיחות שלו נמחקים מ-OpenBot.",
  "connector.discord.missingScopes":
    "אין ל-OpenBot את ההרשאות האלה ב-Discord: {scopes}. יש לנתק את שרת Discord ולחבר אותו שוב.",
  "connector.discord.retryAt": "Discord ביקש מ-OpenBot להמתין. הוא ינסה שוב ב-{time}.",
  "connector.discord.reconnect": "חיבור מחדש",
  "connector.discord.pause": "השהיה",
  "connector.discord.resume": "המשך",
  // {action} is a button, such as Pause; {name} is the Discord server name.
  "connector.discord.rowAction": "{action}: {name}",
  "connector.discord.orchestratorTitle": "מתזמר Discord",
  "connector.discord.orchestratorDescription":
    "הסוכן הזה מקבל כל בקשה מ-Discord. הוא עונה בעצמו על בקשות קצרות, מעביר עבודה אחרת לסוכן המתאים ומשיב בערוץ עם התשובה.",
  "connector.discord.orchestratorNone": "אין עדיין סוכן שעונה",
  "connector.discord.orchestratorNoneDescription": "יש להוסיף את מתזמר Discord, אחרת Discord לא יקבל תשובה.",
  "connector.discord.channelsNote": "OpenBot רואה את הערוצים שהתפקיד שלו יכול לראות.",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.discord.stepWorkspace": "שרת Discord",
  "connector.discord.stepAgent": "סוכן",
  "connector.discord.connectTitle": "חיבור שרת Discord",
  "connector.discord.connectDescription": "OpenBot מוסיף בוט אחד, בשם OpenBot, לשרת Discord.",
  "connector.discord.connectStepBrowser": "Discord נפתח בדפדפן",
  "connector.discord.connectStepAllow": "יש לבחור את השרת ואז באישור (Authorize)",
  "connector.discord.connectStepReturn": "החלון הזה ממשיך כש-Discord מסיים",
  "connector.discord.connectInDiscord": "חיבור ב-Discord",
  "connector.discord.connectWaiting": "ממתין ל-Discord. יש לסיים את האישור בדפדפן.",
  "connector.discord.agentStepTitle": "הוספת מתזמר Discord",
  // {workspace} is the Discord server name.
  "connector.discord.agentStepDescription": "הסוכן החדש הזה עונה על כל מה שנשלח אל @OpenBot ב-{workspace}.",
  "connector.discord.orchestratorName": "מתזמר Discord",
  "connector.discord.orchestratorRole": "עונה ב-Discord ופונה לצוות",
  "connector.discord.orchestratorDoesReceive": "מקבל קודם כל בקשה מ-Discord",
  "connector.discord.orchestratorDoesDelegate": "מעביר כל משימה לסוכן המתאים ביותר",
  "connector.discord.orchestratorDoesAnswer": "משיב עם התשובה בערוץ ב-Discord",
  "connector.discord.orchestratorModel": "מודל",
  "connector.discord.doneTitle": "OpenBot נמצא ב-{workspace}",
  "connector.discord.doneDescription": "אפשר לתייג את @OpenBot בערוץ. כדי להמשיך יש להשיב ל-OpenBot.",
  "connector.discord.done": "סיום",
  "connector.discord.disconnectTitle": "לנתק את {workspace}?",
  "connector.discord.disconnectDescription": "OpenBot מפסיק לענות ב-{workspace} ומסיר את החיבור ל-Discord מהמחשב הזה.",
  "connector.discord.disconnectDescriptionHost":
    "OpenBot מפסיק לענות ב-{workspace} ומסיר את החיבור ל-Discord מ-{host}.",
  "connector.discord.disconnectEffect": "אנשים ב-{workspace} לא יוכלו עוד להגיע לסוכנים שלך דרך @OpenBot.",
  "connector.discord.removeEffectKept": "השיחות ומתזמר Discord נשארים ב-OpenBot.",
  "connector.discord.removeEffectDeleted": "מתזמר Discord והשיחות שלו נמחקים מ-OpenBot.",
  "connector.discord.keep": "השארת החיבור",
  "connector.discord.close": "סגירה",
  "connector.discord.addWorkspace": "הוספת שרת Discord",
  "connector.discord.limitReached": {
    one: "אפשר לחבר שרת Discord אחד לכל היותר.",
    two: "אפשר לחבר שני שרתי Discord לכל היותר.",
    other: "אפשר לחבר {count} שרתי Discord לכל היותר.",
  },
  // {count} is the number of Discord servers: two or more.
  "connector.discord.summaryMany": {
    one: "שרת Discord אחד · מתזמר Discord עונה",
    two: "שני שרתי Discord · מתזמר Discord עונה",
    other: "{count} שרתי Discord · מתזמר Discord עונה",
  },
  // Who can use OpenBot in one Discord server: the members with one of the chosen Discord roles.
  "connector.discord.accessTitle": "מי יכול להשתמש ב-OpenBot",
  "connector.discord.accessDescription": "OpenBot עונה רק לאנשים האלה. הוא מתעלם מתיוגים של אחרים.",
  "connector.discord.accessEveryone": "כל אחד בשרת",
  "connector.discord.accessEveryoneDescription": "כל מי שיכול לכתוב בערוץ ש-OpenBot רואה יכול לתייג אותו.",
  // {roles} is a list of Discord role names, such as "Admin and Moderator".
  "connector.discord.accessRoles": "חברים עם {roles}",
  "connector.discord.accessChoose": "בחירת תפקידים",
  // {workspace} is the Discord server name.
  "connector.discord.accessDialogTitle": "מי יכול להשתמש ב-OpenBot ב-{workspace}?",
  "connector.discord.accessDialogDescription": "אם לא נבחר תפקיד, כל אחד יכול לתייג את OpenBot.",
  "connector.discord.accessLoading": "טוען תפקידים…",
  "connector.discord.accessLoadFailed": "תפקידי Discord לא נטענו",
  "connector.discord.accessNoRoles": "אין בשרת הזה תפקידים לבחירה.",
  // {role} is the name of a Discord role that the server no longer has.
  "connector.discord.accessRoleDeleted": "{role} (נמחק)",
  "connector.discord.accessSave": "שמירה",
  // {host} is the joined server's name.
  "connector.discord.accessHostUpdate": "יש לעדכן את OpenBot ב-{host} כדי לבחור תפקידים.",

  // Marketplace > Apps > Telegram: each chat adds the one OpenBot bot, and the Telegram
  // Orchestrator agent receives the messages of all chats, asks the team and answers.
  "connector.telegram.title": "Telegram",
  "connector.telegram.description":
    "אפשר להוסיף את הבוט של OpenBot לקבוצה ב-Telegram או לפתוח איתו צ'אט ישיר. מתזמר Telegram פונה לסוכן המתאים ועונה.",
  "connector.telegram.statusConnected": "מחובר",
  "connector.telegram.statusAttention": "דורש תשומת לב",
  // {count} is the number of linked Telegram chats.
  "connector.telegram.summaryConnected": {
    one: "צ'אט אחד · מתזמר Telegram עונה",
    two: "שני צ'אטים · מתזמר Telegram עונה",
    other: "{count} צ'אטים · מתזמר Telegram עונה",
  },
  "connector.telegram.summaryNoAgent": {
    one: "צ'אט אחד · אין עדיין סוכן שעונה",
    two: "שני צ'אטים · אין עדיין סוכן שעונה",
    other: "{count} צ'אטים · אין עדיין סוכן שעונה",
  },
  "connector.telegram.attentionTitle": {
    one: "צ'אט אחד דורש תשומת לב",
    two: "שני צ'אטים דורשים תשומת לב",
    other: "{count} צ'אטים דורשים תשומת לב",
  },
  "connector.telegram.attentionDescription": "הסטטוס שמוצג למטה מסביר מה לעשות.",
  "connector.telegram.connect": "חיבור Telegram",
  "connector.telegram.addAgent": "הוספת סוכן",
  "connector.telegram.actionFailed": "Telegram לא קיבל את השינוי",
  "connector.telegram.chatsTitle": "צ'אטים",
  "connector.telegram.groupDescription": "אפשר לתייג את הבוט או להשיב להודעות שלו.",
  "connector.telegram.directDescription": "כל הודעה בצ'אט הזה עוברת למתזמר Telegram.",
  "connector.telegram.helpRemoved": "הבוט של OpenBot כבר לא נמצא בצ'אט הזה. יש לנתק את הצ'אט ולהוסיף את הבוט שוב.",
  "connector.telegram.helpRelayUnavailable":
    "OpenBot לא יכול לקבל הודעות Telegram במחשב הזה. יש להתחבר, לתת למחשב הזה שם בהגדרות השרת ולהשאיר את OpenBot פתוח.",
  "connector.telegram.helpRelayUnavailableHost":
    "OpenBot ב-{host} לא יכול לקבל הודעות Telegram. ב-{host} יש להתחבר, לתת לשרת שם בהגדרות השרת ולהשאיר את OpenBot פתוח.",
  "connector.telegram.helpError": "OpenBot לא מצליח להגיע לצ'אט הזה. יש לחבר מחדש או לנתק את הצ'אט.",
  "connector.telegram.helpNotLinked": 'הצ\'אט הזה לא מקושר לשרת הזה. בחרו "חיבור מחדש" כדי לקשר אותו.',
  "connector.telegram.retryAt": "Telegram ביקש מ-OpenBot להמתין. הוא ינסה שוב ב-{time}.",
  "connector.telegram.pause": "השהיה",
  "connector.telegram.resume": "המשך",
  "connector.telegram.reconnect": "חיבור מחדש",
  "connector.telegram.disconnectChat": "ניתוק",
  "connector.telegram.disconnectAllTitle": "ניתוק Telegram",
  "connector.telegram.disconnectAllSummary": "כל הצ'אטים מתנתקים. אי אפשר עוד להגיע לסוכנים שלך דרך הבוט של OpenBot.",
  "connector.telegram.disconnectAllSummaryOrchestrator":
    "כל הצ'אטים מתנתקים. מתזמר Telegram והשיחות שלו נמחקים מ-OpenBot.",
  // {action} is a button, such as Pause; {name} is the chat name.
  "connector.telegram.rowAction": "{action}: {name}",
  "connector.telegram.linkChat": "קישור צ'אט",
  "connector.telegram.addToGroup": "הוספה לקבוצה",
  "connector.telegram.openDirectChat": "פתיחת צ'אט ישיר",
  "connector.telegram.orchestratorTitle": "מתזמר Telegram",
  "connector.telegram.orchestratorDescription":
    "הסוכן הזה מקבל את ההודעות ל-OpenBot מכל הצ'אטים שלך ב-Telegram. הוא עונה בעצמו על הודעות קצרות, מעביר עבודה אחרת לסוכן המתאים ומפרסם את התשובה בצ'אט.",
  "connector.telegram.orchestratorNone": "אין עדיין סוכן שעונה",
  "connector.telegram.orchestratorNoneDescription": "יש להוסיף את מתזמר Telegram, אחרת Telegram לא יקבל תשובה.",
  "connector.telegram.mentionNote": "בקבוצה יש לתייג את הבוט או להשיב להודעות שלו. בצ'אט ישיר כל הודעה עוברת לבוט.",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.telegram.stepChat": "צ'אט",
  "connector.telegram.stepAgent": "סוכן",
  "connector.telegram.connectTitle": "קישור צ'אט של Telegram",
  "connector.telegram.connectDescription":
    "אפשר להוסיף את הבוט של OpenBot לקבוצה או לפתוח איתו צ'אט ישיר. בוט אחד משרת את כל הצ'אטים שלך.",
  "connector.telegram.connectStepBrowser": "Telegram נפתח בדפדפן",
  "connector.telegram.connectStepPick": "יש לבחור את הקבוצה, או ללחוץ על התחלה (Start) בצ'אט הישיר",
  "connector.telegram.connectStepReturn": "החלון הזה ממשיך כשהצ'אט מקושר",
  "connector.telegram.connectWaiting": "ממתין ל-Telegram. יש לבחור את הצ'אט ב-Telegram.",
  "connector.telegram.agentStepTitle": "הוספת מתזמר Telegram",
  // {chat} is the Telegram chat name.
  "connector.telegram.agentStepDescription":
    "הסוכן החדש הזה עונה על ההודעות ל-OpenBot ב-{chat} ובכל צ'אט שיקושר בהמשך.",
  "connector.telegram.orchestratorName": "מתזמר Telegram",
  "connector.telegram.orchestratorRole": "עונה ב-Telegram ופונה לצוות",
  "connector.telegram.orchestratorDoesReceive": "מקבל קודם כל הודעה ל-OpenBot מ-Telegram",
  "connector.telegram.orchestratorDoesDelegate": "מעביר כל משימה לסוכן המתאים ביותר",
  "connector.telegram.orchestratorDoesAnswer": "מפרסם את התשובה בצ'אט ב-Telegram",
  "connector.telegram.orchestratorModel": "מודל",
  "connector.telegram.doneTitle": "OpenBot נמצא ב-{chat}",
  "connector.telegram.done": "סיום",
  "connector.telegram.disconnectTitle": "לנתק את {chat}?",
  "connector.telegram.leaveDescription": "הבוט של OpenBot עוזב את {chat}, ו-OpenBot מפסיק לענות שם.",
  "connector.telegram.disconnectEffect": "אנשים ב-{chat} לא יוכלו עוד להגיע לסוכנים שלך דרך הבוט של OpenBot.",
  "connector.telegram.removeEffectKept": "השיחות ומתזמר Telegram נשארים ב-OpenBot.",
  "connector.telegram.removeEffectDeleted": "זה הצ'אט האחרון, ולכן מתזמר Telegram והשיחות שלו נמחקים מ-OpenBot.",
  "connector.telegram.keep": "השארת החיבור",
  "connector.telegram.close": "סגירה",
  // Marketplace > Apps > WhatsApp: a WhatsApp number links this computer as a device, and the
  // WhatsApp Orchestrator agent receives the messages of all numbers, asks the team and answers.
  "connector.whatsapp.title": "WhatsApp",
  "connector.whatsapp.description": "אפשר לקשר מספר WhatsApp למחשב הזה. מתזמר WhatsApp פונה לסוכן המתאים ועונה.",
  "connector.whatsapp.descriptionHost": "אפשר לקשר מספר WhatsApp לשרת הזה. מתזמר WhatsApp פונה לסוכן המתאים ועונה.",
  "connector.whatsapp.statusConnected": "מחובר",
  "connector.whatsapp.statusAttention": "דורש תשומת לב",
  // {count} is the number of linked WhatsApp numbers.
  "connector.whatsapp.summaryConnected": {
    one: "מספר אחד · מתזמר WhatsApp עונה",
    two: "שני מספרים · מתזמר WhatsApp עונה",
    other: "{count} מספרים · מתזמר WhatsApp עונה",
  },
  "connector.whatsapp.summaryNoAgent": {
    one: "מספר אחד · אין עדיין סוכן שעונה",
    two: "שני מספרים · אין עדיין סוכן שעונה",
    other: "{count} מספרים · אין עדיין סוכן שעונה",
  },
  "connector.whatsapp.attentionTitle": {
    one: "מספר אחד דורש תשומת לב",
    two: "שני מספרים דורשים תשומת לב",
    other: "{count} מספרים דורשים תשומת לב",
  },
  "connector.whatsapp.attentionDescription": "הסטטוס שמוצג למטה מסביר מה לעשות.",
  "connector.whatsapp.connect": "קישור WhatsApp",
  "connector.whatsapp.addAgent": "הוספת סוכן",
  "connector.whatsapp.actionFailed": "WhatsApp לא קיבל את השינוי",
  "connector.whatsapp.numbersTitle": "מספרים",
  "connector.whatsapp.linkNumber": "קישור מספר",
  "connector.whatsapp.ownNumberNote": "הצ'אט ״הודעה לעצמך״ והאנשים שאישרת יכולים להגיע ל-OpenBot.",
  "connector.whatsapp.dedicatedNote": "האנשים שאישרת יכולים להגיע ל-OpenBot. אנשים אחרים מקבלים קוד שיש למסור לך.",
  "connector.whatsapp.helpLoggedOut": "WhatsApp הסיר את המחשב הזה מהמכשירים המקושרים. יש לקשר את המספר שוב.",
  "connector.whatsapp.helpLoggedOutHost": "WhatsApp הסיר את השרת הזה מהמכשירים המקושרים. יש לקשר את המספר שוב.",
  "connector.whatsapp.helpError": "OpenBot לא מצליח להגיע ל-WhatsApp במספר הזה. יש לחבר מחדש או לנתק את המספר.",
  "connector.whatsapp.helpKeysUnreadable":
    "OpenBot לא מצליח לקרוא את המפתחות השמורים של המספר הזה. יש לקשר את המספר שוב.",
  "connector.whatsapp.retryAt": "WhatsApp ביקש מ-OpenBot להמתין. הוא ינסה שוב ב-{time}.",
  "connector.whatsapp.pause": "השהיה",
  "connector.whatsapp.resume": "המשך",
  "connector.whatsapp.reconnect": "חיבור מחדש",
  "connector.whatsapp.linkAgain": "קישור מחדש",
  "connector.whatsapp.disconnect": "ניתוק",
  "connector.whatsapp.disconnectAllTitle": "ניתוק WhatsApp",
  "connector.whatsapp.disconnectAllSummary": "כל המספרים מתנתקים. אי אפשר עוד להגיע לסוכנים שלך דרך WhatsApp.",
  "connector.whatsapp.disconnectAllSummaryOrchestrator":
    "כל המספרים מתנתקים. מתזמר WhatsApp והשיחות שלו נמחקים מ-OpenBot.",
  // {action} is a button, such as Pause; {name} is the WhatsApp number or a person's name.
  "connector.whatsapp.rowAction": "{action}: {name}",
  "connector.whatsapp.ownNumber": "מספר אישי",
  "connector.whatsapp.ownNumberDescription":
    "רק הצ'אט ״הודעה לעצמך״ והאנשים שאישרת יכולים לכתוב. יש לכבות עבור מספר שמיועד רק ל-OpenBot.",
  "connector.whatsapp.workingMessage": "הודעת ״עובד על זה…״",
  "connector.whatsapp.workingMessageDescription":
    "OpenBot שולח אותה בזמן שהסוכן עובד, ואז מחליף אותה בתשובה. יש לכבות כדי לשלוח רק את התשובה.",
  "connector.whatsapp.orchestratorTitle": "מתזמר WhatsApp",
  "connector.whatsapp.orchestratorDescription":
    "הסוכן הזה מקבל את ההודעות ל-OpenBot מכל המספרים המקושרים שלך. הוא עונה בעצמו על הודעות קצרות, מעביר עבודה אחרת לסוכן המתאים ועונה ב-WhatsApp.",
  "connector.whatsapp.orchestratorNone": "אין עדיין סוכן שעונה",
  "connector.whatsapp.orchestratorNoneDescription": "יש להוסיף את מתזמר WhatsApp, אחרת WhatsApp לא יקבל תשובה.",
  "connector.whatsapp.note": "במספר האישי שלך יש לכתוב בצ'אט ״הודעה לעצמך״. האנשים שאישרת כותבים למספר.",
  // The link dialog. The steps show as numbers; screen readers read the names.
  "connector.whatsapp.stepNumber": "מספר",
  "connector.whatsapp.stepAgent": "סוכן",
  "connector.whatsapp.connectTitle": "קישור WhatsApp",
  "connector.whatsapp.connectDescription": "יש לבחור את המספר ואז לקשר את המחשב הזה מ-WhatsApp בטלפון.",
  "connector.whatsapp.connectDescriptionHost": "יש לבחור את המספר ואז לקשר את השרת הזה מ-WhatsApp בטלפון.",
  "connector.whatsapp.kindLabel": "מספר",
  "connector.whatsapp.kindPersonal": "המספר האישי שלי",
  "connector.whatsapp.kindPersonalDescription": "OpenBot עונה רק בצ'אט ״הודעה לעצמך״ ולאנשים שאישרת.",
  "connector.whatsapp.kindDedicated": "מספר רק עבור OpenBot",
  "connector.whatsapp.kindDedicatedDescription": "אנשים לא מוכרים מקבלים קוד שיש למסור לך. את האישור נותנים כאן.",
  "connector.whatsapp.methodLabel": "אופן הקישור",
  "connector.whatsapp.methodQr": "קוד QR",
  "connector.whatsapp.methodCode": "קוד צימוד",
  "connector.whatsapp.phoneLabel": "מספר טלפון",
  "connector.whatsapp.phoneDescription": "עם קידומת המדינה, למשל +44 7700 900123.",
  "connector.whatsapp.phoneInvalid": "יש להקליד את מספר הטלפון עם קידומת המדינה.",
  "connector.whatsapp.showQr": "הצגת קוד QR",
  "connector.whatsapp.getCode": "קבלת קוד",
  "connector.whatsapp.starting": "מבקש קוד מ-WhatsApp…",
  "connector.whatsapp.connectStepOpen": "יש לפתוח את WhatsApp בטלפון",
  "connector.whatsapp.connectStepDevices": "יש ללחוץ על הגדרות, אחר כך על מכשירים מקושרים, ואז על קישור מכשיר",
  "connector.whatsapp.connectStepScan": "יש לכוון את הטלפון אל הקוד הזה",
  "connector.whatsapp.connectWaiting": "ממתין לטלפון. הקוד מתחלף בערך כל 20 שניות.",
  "connector.whatsapp.qrLabel": "קוד הקישור של WhatsApp",
  "connector.whatsapp.codeStepDevices": "ב-WhatsApp יש לפתוח מכשירים מקושרים וללחוץ על קישור מכשיר",
  "connector.whatsapp.codeStepPhone": "יש ללחוץ על קישור עם מספר טלפון במקום זאת",
  "connector.whatsapp.codeStepType": "יש להקליד את הקוד הזה בטלפון",
  // {code} is the pairing code, read one character at a time.
  "connector.whatsapp.codeLabel": "קוד צימוד {code}",
  "connector.whatsapp.copyCode": "העתקת הקוד",
  "connector.whatsapp.codeWaiting": "ממתין לטלפון.",
  "connector.whatsapp.failedTitle": "הקישור ל-WhatsApp נכשל",
  "connector.whatsapp.failedTimeout": "תוקף הקוד פג לפני שהטלפון השתמש בו.",
  "connector.whatsapp.failedRefused": "WhatsApp דחה את הקישור. יש להמתין כמה דקות ולנסות שוב.",
  "connector.whatsapp.failedBusy": "קישור אחר מתבצע. יש להמתין לסיומו ולנסות שוב.",
  "connector.whatsapp.failedUnavailable": "OpenBot לא מצליח להגיע ל-WhatsApp. יש לבדוק את החיבור לאינטרנט.",
  "connector.whatsapp.tryAgain": "ניסיון חוזר",
  "connector.whatsapp.agentStepTitle": "הוספת מתזמר WhatsApp",
  // {number} is the WhatsApp number or its name.
  "connector.whatsapp.agentStepDescription":
    "הסוכן החדש הזה עונה על ההודעות ל-OpenBot ב-{number} ובכל מספר שיקושר בהמשך.",
  "connector.whatsapp.orchestratorName": "מתזמר WhatsApp",
  "connector.whatsapp.orchestratorRole": "עונה ב-WhatsApp ופונה לצוות",
  "connector.whatsapp.orchestratorDoesReceive": "מקבל קודם כל הודעה ל-OpenBot מ-WhatsApp",
  "connector.whatsapp.orchestratorDoesDelegate": "מעביר כל משימה לסוכן המתאים ביותר",
  "connector.whatsapp.orchestratorDoesAnswer": "עונה בצ'אט ב-WhatsApp",
  "connector.whatsapp.orchestratorModel": "מודל",
  "connector.whatsapp.doneTitle": "OpenBot מקושר ל-{number}",
  "connector.whatsapp.done": "סיום",
  "connector.whatsapp.disconnectTitle": "לנתק את {number}?",
  "connector.whatsapp.disconnectDescription":
    "OpenBot מתנתק מ-WhatsApp ב-{number}. אם OpenBot היה כבוי, יש להסיר את המכשיר גם ב-WhatsApp > מכשירים מקושרים.",
  "connector.whatsapp.disconnectEffect": "אי אפשר עוד להגיע לסוכנים שלך דרך {number}.",
  "connector.whatsapp.removeEffectKept": "השיחות ומתזמר WhatsApp נשארים ב-OpenBot.",
  "connector.whatsapp.removeEffectDeleted": "זה המספר האחרון, ולכן מתזמר WhatsApp והשיחות שלו נמחקים מ-OpenBot.",
  "connector.whatsapp.keep": "השארת הקישור",
  "connector.whatsapp.close": "סגירה",
  // Who can give work through one number: contacts by phone number, and groups.
  "connector.whatsapp.sendersTitle": "מי יכול לכתוב אל {number}",
  "connector.whatsapp.sendersDescription": "אנשי הקשר והקבוצות האלה יכולים לתת עבודה לסוכנים שלך.",
  "connector.whatsapp.sendersEmpty": "רק בעל החשבון יכול לכתוב. אפשר להוסיף איש קשר או קבוצה.",
  "connector.whatsapp.sendersLimit": "מספר אחד יכול לאשר עד {count} אנשי קשר וקבוצות.",
  "connector.whatsapp.senderGroup": "קבוצה",
  "connector.whatsapp.removeSender": "הסרה",
  "connector.whatsapp.addContact": "הוספת איש קשר",
  "connector.whatsapp.addGroup": "הוספת קבוצה",
  "connector.whatsapp.contactTitle": "הוספת איש קשר",
  "connector.whatsapp.contactDescription": "האדם הזה יכול לתת עבודה לסוכנים שלך מ-WhatsApp.",
  "connector.whatsapp.contactName": "שם",
  "connector.whatsapp.contactNameDescription": "אופציונלי. אם השדה ריק, הרשימה מציגה את מספר הטלפון.",
  "connector.whatsapp.add": "הוספה",
  "connector.whatsapp.groupTitle": "הוספת קבוצה",
  "connector.whatsapp.groupDescription": "אנשים בקבוצה הזו יכולים לתת עבודה לסוכנים שלך.",
  "connector.whatsapp.groupSearch": "חיפוש קבוצות",
  "connector.whatsapp.groupsLoading": "קורא את הקבוצות…",
  "connector.whatsapp.groupsLoadFailed": "OpenBot לא הצליח לקרוא את הקבוצות",
  "connector.whatsapp.groupsEmpty": "המספר הזה לא נמצא באף קבוצה.",
  "connector.whatsapp.groupsNoMatch": "אין קבוצה בשם הזה.",
  "connector.whatsapp.groupAdded": "נוספה",
  // People who wrote to a number only for OpenBot and got a code to give the owner.
  "connector.whatsapp.requestsTitle": "בקשות עבור {number}",
  "connector.whatsapp.requestsDescription": "האנשים האלה כתבו למספר וקיבלו קוד. יש לאשר אדם רק אם מסר לך את אותו קוד.",
  "connector.whatsapp.requestsEmpty": "אין בקשות.",
  // {code} is the 6-character code; {number} is the person's phone number, partly hidden.
  "connector.whatsapp.requestDetail": "קוד {code} · {number}",
  "connector.whatsapp.approve": "אישור",
  "connector.whatsapp.deny": "דחייה",
  // Marketplace > 1Password: a vault that the user shares with OpenBot through a service account.
  "connector.onePassword.title": "1Password",
  "connector.onePassword.description":
    "אפשר לשתף עם OpenBot כספת ייעודית של 1Password דרך חשבון שירות, כדי שסוכנים יוכלו להתחבר לאתרים בדפדפן של OpenBot.",
  "connector.onePassword.howItWorks":
    "החיבור מגדיר כספת בשם ״Shared with OpenBot״ בחשבון 1Password שלך וחשבון שירות שיכול לקרוא רק את הכספת הזו. OpenBot ממלא פרטי כניסה שמורים בדפדפן שלו במחשב הזה, ולכן משותפים רק הפריטים שהעברת לכספת הזו. סוכנים אף פעם לא רואים סיסמה.",
  "connector.onePassword.connect": "חיבור 1Password",
  // The three setup steps before a connection, each with the one button it needs.
  "connector.onePassword.setupTitle": "הגדרה",
  "connector.onePassword.stepCliTitle": "התקנת 1Password CLI",
  "connector.onePassword.stepCliChecking": "מחפש את 1Password CLI במחשב הזה",
  "connector.onePassword.stepCliInstalling": "מוריד את 1Password CLI מ-1Password",
  // {version} is a version number, such as 2.39.0.
  "connector.onePassword.stepCliReady": "גרסה {version} מותקנת.",
  "connector.onePassword.stepCliMissing": "OpenBot מוריד אותו מ-1Password לתיקייה משלו. אין צורך בסיסמת מנהל.",
  "connector.onePassword.stepCliManual":
    "OpenBot לא יכול להתקין אותו במחשב הזה. יש להתקין אותו מ-1Password ואז לחזור לדף הזה.",
  "connector.onePassword.installCli": "התקנה",
  "connector.onePassword.stepAppTitle": "הפעלת שילוב ה-CLI",
  "connector.onePassword.stepAppDescription":
    "באפליקציית 1Password יש לפתוח הגדרות > מפתחים ולהפעיל את ״Integrate with 1Password CLI״.",
  "connector.onePassword.stepAppReady": "אפליקציית 1Password מאפשרת ל-CLI ליצור את הכספת המשותפת.",
  "connector.onePassword.openApp": "פתיחת 1Password",
  "connector.onePassword.openAppFailed": "OpenBot לא הצליח לפתוח את 1Password.",
  "connector.onePassword.checkAgain": "בדיקה חוזרת",
  "connector.onePassword.stepVaultTitle": "יצירת הכספת המשותפת",
  "connector.onePassword.stepVaultDescription":
    "OpenBot יוצר את הכספת ״Shared with OpenBot״ וחשבון שירות שיכול רק לקרוא אותה. 1Password מבקש ממך לאשר.",
  // The last row of the setup steps: the other way to connect, without the CLI.
  "connector.onePassword.useTokenDescription": "במקום השלבים האלה, אפשר להדביק אסימון של חשבון שירות מ-1Password.com.",
  "connector.onePassword.useTokenAction": "שימוש באסימון",
  "connector.onePassword.tokenLabel": "אסימון חשבון שירות",
  "connector.onePassword.tokenPlaceholder": "ops_…",
  "connector.onePassword.connectWithToken": "חיבור",
  "connector.onePassword.approveInApp": "יש לאשר את הבקשה באפליקציית 1Password",
  "connector.onePassword.cancel": "ביטול",
  "connector.onePassword.chooseAccountTitle": "בחירת חשבון",
  "connector.onePassword.chooseAccountDescription": "OpenBot יוצר את הכספת המשותפת בחשבון שייבחר.",
  "connector.onePassword.useAccount": "שימוש בחשבון הזה",
  "connector.onePassword.vaultTitle": "כספת משותפת",
  "connector.onePassword.vaultDescription":
    "כדי לאפשר לסוכנים להתחבר עם פרטי כניסה, יש להעביר אותם לכספת הזו ב-1Password. כדי להפסיק, יש להסיר אותם.",
  "connector.onePassword.loginsLoading": "קורא את פרטי הכניסה מ-1Password",
  // {count} is a number, such as 3.
  "connector.onePassword.loginCount": { one: "כניסה אחת", two: "שתי כניסות", other: "{count} כניסות" },
  "connector.onePassword.disconnect": "ניתוק",
  "connector.onePassword.disconnectTitle": "ניתוק 1Password",
  "connector.onePassword.disconnectSummary":
    "OpenBot שוכח את האסימון. הכספת וחשבון השירות נשארים ב-1Password; אם אין בהם צורך, יש להסיר אותם שם.",
  "connector.onePassword.actionFailed": "OpenBot לא הצליח לשנות את החיבור ל-1Password.",
  "connector.onePassword.statusConnected": "מחובר",
  "connector.onePassword.statusConnecting": "מתחבר",
  // The same page for the connection of a joined server. {host} is the server name, such as Studio.
  "connector.onePassword.descriptionHost":
    "אפשר לשתף עם OpenBot ב-{host} כספת ייעודית של 1Password דרך חשבון שירות, כדי שסוכנים ב-{host} יוכלו להתחבר לאתרים בדפדפן שלו.",
  "connector.onePassword.howItWorksHost":
    "{host} מתחבר באמצעות אסימון של חשבון שירות. ב-1Password.com יש ליצור חשבון שירות שיכול לקרוא רק את הכספת ששיתפת עם OpenBot, ולהדביק כאן את האסימון שלו. {host} בודק את האסימון ושומר אותו; המחשב הזה לא. סוכנים אף פעם לא רואים סיסמה.",
  "connector.onePassword.disconnectSummaryHost":
    "{host} שוכח את האסימון. הכספת וחשבון השירות נשארים ב-1Password; אם אין בהם צורך, יש להסיר אותם שם.",
  "connector.bitwarden.title": "Bitwarden",
  "connector.bitwarden.description": "מילוי פרטי כניסה בדפדפן מ-Bitwarden.",
  "connector.bitwarden.setup":
    "יש להתקין את Bitwarden CLI ולהתחבר עם bw login. יש ליצור תיקייה בשם Shared with OpenBot ולהכניס אליה רק את פרטי הכניסה שסוכנים רשאים להשתמש בהם. יש להריץ bw unlock --raw ולהדביק למטה את מפתח הסשן. אין להדביק את הסיסמה הראשית.",
  "connector.bitwarden.scope":
    "כל הסוכנים במחשב הזה יכולים להשתמש בפרטי כניסה תואמים בתיקייה Shared with OpenBot. OpenBot משתמש במקורות HTTPS מדויקים. הוא לא משתמש בפריטים שדורשים בקשת סיסמה ראשית או כלל התאמת URI מותאם אישית.",
  "connector.bitwarden.session":
    "מפתח הסשן נשאר בזיכרון. יש להתחבר שוב אחרי 8 שעות בלי שימוש בכספת או אחרי ש-OpenBot נסגר. הניתוק עוצר את הגישה של OpenBot; הוא לא נועל לקוחות Bitwarden אחרים.",
  "connector.bitwarden.sessionKey": "מפתח סשן של Bitwarden",
  "connector.bitwarden.connect": "חיבור Bitwarden",
  "connector.bitwarden.disconnect": "ניתוק Bitwarden",
  "connector.bitwarden.disconnectAction": "ניתוק",
  "connector.bitwarden.disconnectSummary":
    "OpenBot שוכח את מפתח הסשן. סוכנים לא יכולים עוד למלא פרטי כניסה מ-Bitwarden. לקוחות Bitwarden אחרים נשארים פתוחים.",
  "connector.bitwarden.disconnectSummaryHost":
    "{host} מסיר את מפתח ה-API ואת הסיסמה הראשית. סוכנים ב-{host} לא יכולים עוד למלא פרטי כניסה מ-Bitwarden.",
  "connector.bitwarden.connected": "מחובר",
  "connector.bitwarden.actionFailed": "OpenBot לא הצליח לשנות את החיבור ל-Bitwarden.",
  "connector.bitwarden.descriptionHost": "מילוי פרטי כניסה בדפדפן ב-{host} מ-Bitwarden או מ-Vaultwarden.",
  "connector.bitwarden.setupHost":
    "{host} מתחבר עם Bitwarden CLI משלו. בכספת שלך יש ליצור תיקייה בשם Shared with OpenBot ולהכניס אליה רק את פרטי הכניסה שסוכנים רשאים להשתמש בהם. בכספת באינטרנט יש לפתוח הגדרות › אבטחה › מפתחות ולהציג את מפתח ה-API. יש להזין למטה את כתובת השרת, client_id, client_secret ואת הסיסמה הראשית.",
  "connector.bitwarden.scopeHost":
    "כל הסוכנים ב-{host} יכולים להשתמש בפרטי כניסה תואמים בתיקייה Shared with OpenBot. OpenBot משתמש במקורות HTTPS מדויקים. הוא לא משתמש בפריטים שדורשים בקשת סיסמה ראשית או כלל התאמת URI מותאם אישית.",
  "connector.bitwarden.sessionHost":
    "{host} שומר את מפתח ה-API ואת הסיסמה הראשית מוצפנים, כדי שיוכל לבטל את הנעילה שוב אחרי הפעלה מחדש. המחשב הזה לא שומר אותם. הניתוק מסיר אותם מ-{host}. {host} חייב להגיע לכתובת השרת דרך HTTPS.",
  "connector.bitwarden.serverUrl": "כתובת השרת",
  "connector.bitwarden.folderTitle": "תיקייה משותפת",
  "connector.bitwarden.folderDescription":
    "כדי לאפשר לסוכנים להתחבר עם פרטי כניסה, יש להעביר אותם לתיקייה הזו ב-Bitwarden. כדי להפסיק, יש להסיר אותם.",
  // The exact folder name that OpenBot looks for in the vault. Keep it in English.
  "connector.bitwarden.folderName": "Shared with OpenBot",
  "connector.bitwarden.folderKind": "תיקייה ב-Bitwarden",
  "connector.bitwarden.clientId": "client_id של מפתח ה-API",
  "connector.bitwarden.clientSecret": "client_secret של מפתח ה-API",
  "connector.bitwarden.masterPassword": "סיסמה ראשית",
  "connector.bitwarden.connecting": "מתחבר",
  "connector.protonPass.title": "Proton Pass",
  "connector.protonPass.description": "אפשר לתת לסוכנים להתחבר לאתרים עם פרטי הכניסה בכספת משותפת של Proton Pass.",
  "connector.protonPass.descriptionHost":
    "אפשר לתת לסוכנים ב-{host} להתחבר לאתרים עם פרטי הכניסה בכספת משותפת של Proton Pass.",
  "connector.protonPass.connect": "חיבור",
  "connector.protonPass.moreWays": "דרכים נוספות להתחבר",
  "connector.protonPass.useKey": "שימוש במפתח גישה",
  "connector.protonPass.keyLabel": "מפתח גישה",
  // A Proton Pass access key starts with pst_.
  "connector.protonPass.keyPlaceholder": "pst_…",
  "connector.protonPass.setupTitle": "הגדרה",
  "connector.protonPass.setupDescription":
    "החיבור פותח את ההתחברות של Proton בדפדפן. לאחר מכן OpenBot יוצר את הכספת המשותפת ושומר רק מפתח לקריאה בלבד עבורה.",
  "connector.protonPass.setupDescriptionHost":
    "החיבור פותח את ההתחברות של Proton בדפדפן. לאחר מכן {host} יוצר את הכספת המשותפת ושומר רק מפתח לקריאה בלבד עבורה.",
  // The exact vault name that OpenBot makes in Proton Pass. Keep it in English.
  "connector.protonPass.vaultName": "Shared with OpenBot",
  "connector.protonPass.vaultSetup": "OpenBot יוצר את הכספת הזו בעת החיבור. כדי לשתף פרטי כניסה, יש להעביר אותם אליה.",
  "connector.protonPass.showSteps": "הצגת השלבים",
  "connector.protonPass.stepsLabel": "שלבי החיבור",
  "connector.protonPass.stepSignIn": "התחברות",
  "connector.protonPass.stepVault": "יצירת הכספת המשותפת",
  "connector.protonPass.stepDone": "סיום",
  "connector.protonPass.signInTitle": "התחברות ל-Proton",
  "connector.protonPass.signInStarting": "OpenBot מתחיל את ההתחברות. הדף של Proton נפתח בדפדפן.",
  "connector.protonPass.signInDescription": "ההתחברות פתוחה בדפדפן. Proton מבקש את הסיסמה שלך ואת הגורם השני לאימות.",
  "connector.protonPass.signInDescriptionHost":
    "ההתחברות של {host} פתוחה בדפדפן. Proton מבקש את הסיסמה שלך ואת הגורם השני לאימות.",
  "connector.protonPass.extraPasswordDescription": "Proton Pass מבקש את הסיסמה הנוספת שלך.",
  "connector.protonPass.extraPasswordWrong": "הסיסמה הנוספת שגויה. יש להזין אותה שוב.",
  "connector.protonPass.extraPasswordLabel": "סיסמה נוספת",
  "connector.protonPass.continue": "המשך",
  "connector.protonPass.setupStepTitle": "יוצר את הכספת המשותפת",
  "connector.protonPass.setupStepDescription":
    "OpenBot יוצר את הכספת ״{vault}״ ומפתח לקריאה בלבד עבורה. לאחר מכן הוא מתנתק מהסשן שלך ב-Proton.",
  "connector.protonPass.doneTitle": "Proton Pass מחובר",
  "connector.protonPass.doneDescription": "כדי לאפשר לסוכנים להתחבר עם פרטי כניסה, יש להעביר אותם אל ״{vault}״.",
  "connector.protonPass.failedTitle": "החיבור ל-Proton Pass נכשל",
  "connector.protonPass.copyLink": "העתקת הקישור",
  "connector.protonPass.linkCopied": "הועתק",
  "connector.protonPass.openAgain": "פתיחה מחדש",
  "connector.protonPass.done": "סיום",
  "connector.protonPass.close": "סגירה",
  "connector.protonPass.statusConnecting": "מתחבר",
  "connector.protonPass.statusConnected": "מחובר",
  "connector.protonPass.statusExpired": "המפתח פג תוקף",
  "connector.protonPass.expiredTitle": "המפתח של Proton Pass פג תוקף",
  "connector.protonPass.expiredDescription": "סוכנים לא יכולים להתחבר עם פרטי הכניסה המשותפים עד להתחברות מחדש.",
  "connector.protonPass.reconnect": "חיבור מחדש",
  "connector.protonPass.planTitle": "Proton Pass דורש תוכנית בתשלום",
  "connector.protonPass.planDescription":
    "Proton Pass CLI עובד רק עם תוכנית בתשלום של Proton. יש לשנות את התוכנית ואז להתחבר שוב.",
  "connector.protonPass.vaultTitle": "כספת משותפת",
  "connector.protonPass.vaultDescription":
    "סוכנים יכולים להתחבר עם פרטי הכניסה שבכספת הזו. כדי לשתף פרטי כניסה, יש להעביר אותם אליה.",
  "connector.protonPass.loginCount": { one: "כניסה אחת", two: "שתי כניסות", other: "{count} כניסות" },
  "connector.protonPass.loginsLoading": "סופר כניסות…",
  "connector.protonPass.keyExpires": "לקריאה בלבד. תוקף עד {date}.",
  "connector.protonPass.keyExpired": "לקריאה בלבד. פג תוקף בתאריך {date}.",
  "connector.protonPass.keyNoExpiry": "לקריאה בלבד. ללא תפוגה.",
  "connector.protonPass.disconnectTitle": "ניתוק Proton Pass",
  "connector.protonPass.disconnectSummary":
    "OpenBot מוחק את מפתח הגישה שלו במחשב הזה. הכספת ופרטי הכניסה שבה נשארים בחשבון Proton שלך.",
  "connector.protonPass.disconnectSummaryHost":
    "OpenBot מוחק את מפתח הגישה שלו ב-{host}. הכספת ופרטי הכניסה שבה נשארים בחשבון Proton שלך.",
  "connector.protonPass.disconnect": "ניתוק",
  "connector.protonPass.actionFailed": "OpenBot לא הצליח לשנות את החיבור ל-Proton Pass.",
} as const satisfies PartialTranslation<typeof source>;
