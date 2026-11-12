import { defineMessages } from "../../message";

/**
 * The public web pages: the home page, the header, menu and footer around every page, and the pages
 * that do one task: join a server, return from Slack or Discord, return from billing, report a hosted
 * site, and the load error page. `apps/auth-api` renders them on the server in the visitor's language.
 */
export const messages = defineMessages("sitePage", {
  "sitePage.error.title": "This page could not load",
  "sitePage.error.body":
    "Check your connection and reload the page. If it still does not load, go back to the home page.",
  "sitePage.error.reload": "Reload page",
  "sitePage.error.home": "Back to home",
  "sitePage.join.title": "Join an OpenBot server",
  "sitePage.join.description": "Open a private server invitation in OpenBot.",
  "sitePage.join.eyebrow": "Private invitation",
  "sitePage.join.intro":
    "Open this invitation in OpenBot. The app checks the server and asks you to confirm before it connects.",
  "sitePage.join.invalid":
    "This invitation link is not valid or is not complete. Ask the server owner for a new invitation.",
  "sitePage.join.open": "Open OpenBot",
  "sitePage.join.browser": "Open in browser",
  // {browser} and {download} are links. Their text is browserLink and downloadLink.
  "sitePage.join.noApp": "No app? {browser} or {download}.",
  "sitePage.join.noAppMobile": "No app? {browser}.",
  "sitePage.join.browserLink": "Join in this browser",
  "sitePage.join.downloadLink": "download OpenBot",
  // {open} is the label of the button that did not open OpenBot.
  "sitePage.join.notOpened":
    "If OpenBot is on this computer, start it, then press {open} again. If it is not, download it first.",
  // {open} is the label of the button above this note.
  "sitePage.join.mobile":
    "If OpenBot is installed, tap {open}. You can also paste this link into Add server in the app.",
  "sitePage.join.email": "If the invitation came by email, sign in to OpenBot with that email address.",
  // {name} is Slack or Discord on all the connect keys.
  "sitePage.connect.title": "Return to OpenBot",
  "sitePage.connect.failedTitle": "The connection did not finish",
  "sitePage.connect.openApp": "Open OpenBot",
  "sitePage.connect.tryAgainApp": "Try again in OpenBot",
  "sitePage.connect.tryAgainBrowser": "Try again in browser",
  "sitePage.connect.doneInWebClient": "Your OpenBot tab finishes the {name} connection. You can close this tab.",
  "sitePage.connect.doneInApp": "OpenBot finishes the {name} connection on your computer.",
  "sitePage.connect.failure.cancelled": "The {name} connection was cancelled. Nothing changed.",
  "sitePage.connect.failure.expired": "The {name} sign-in expired. Start the connection again.",
  "sitePage.connect.failure.exchange": "{name} did not confirm the connection. Try again.",
  "sitePage.connect.failure.enterprise": "Connect one Slack workspace, not a whole organization.",
  "sitePage.connect.failure.takenSlack":
    "Another OpenBot server already answers this Slack workspace. Disconnect it on that server, then try again.",
  "sitePage.connect.failure.takenDiscord":
    "Another OpenBot server already answers this Discord server. Disconnect it on that server, then try again.",
  "sitePage.connect.failure.unavailable": "OpenBot cannot connect to {name} now. Try again later.",
  "sitePage.connect.failure.tabClosed":
    "The OpenBot tab that started the {name} connection did not answer. Open OpenBot in your browser and connect {name} again.",
  "sitePage.connect.failure.failed": "{name} did not finish the connection. Try again.",
  // {marketplace}, {apps} and {connect} are the names of these screens and that button in the app.
  "sitePage.connect.restartHint": "In OpenBot, open {marketplace}, then {apps}, then {name}, and select {connect}.",
  "sitePage.connect.notOpened":
    "Start OpenBot, then try again. If OpenBot is not on this computer, download it and connect {name} from the app.",
  "sitePage.openApp.title": "Nothing opened?",
  "sitePage.openApp.dismiss": "Not now",
  "sitePage.billing.pageTitle": "OpenBot billing",
  "sitePage.billing.updatedTitle": "Billing updated",
  "sitePage.billing.updatedBody": "Go back to OpenBot. You can close this page.",
  "sitePage.billing.cancelledTitle": "Checkout cancelled",
  "sitePage.billing.cancelledBody": "Nothing was charged. Go back to OpenBot.",
  "sitePage.report.pageTitle": "Report a hosted site — OpenBot",
  "sitePage.report.title": "Report a hosted site",
  "sitePage.report.intro": "Send a report about harmful or unlawful content on an openbot.site address.",
  "sitePage.report.hostnameLabel": "Site address",
  "sitePage.report.hostnameMissing": "Enter the site address",
  "sitePage.report.reasonLabel": "Reason",
  "sitePage.report.reason.phishing": "Phishing",
  "sitePage.report.reason.malware": "Malware",
  "sitePage.report.reason.abuse": "Abuse",
  "sitePage.report.reason.copyright": "Copyright",
  "sitePage.report.reason.other": "Other",
  "sitePage.report.detailsLabel": "Details",
  "sitePage.report.optional": "Optional",
  "sitePage.report.detailsPlaceholder": "What is wrong with this site?",
  "sitePage.report.send": "Send report",
  "sitePage.report.sending": "Sending…",
  "sitePage.report.tooMany": "Too many reports. Try again later.",
  "sitePage.report.sendFailed": "Could not send the report. Try again.",
  // {email} is the contact address. The page shows it as a link.
  "sitePage.report.writeTo": "You can also write to {email}.",
  "sitePage.report.sentTitle": "Report sent",
  "sitePage.report.sentBody": "Thanks. We received your report.",
  "sitePage.report.home": "Go to the home page",
  "sitePage.pricing.title": "OpenBot pricing",
  "sitePage.pricing.description":
    "Hosted servers and a license for teams. OpenBot is free for personal use on your own computer.",
  "sitePage.pricing.imageAlt": "Small team. Bright ideas. Three OpenBot agents under a glass dome",
  "sitePage.pricing.heading": "Pricing",
  // The first block of the pricing page, above the order form.
  "sitePage.pricing.personal.title": "Personal use is free",
  "sitePage.pricing.personal.body":
    "Every feature, on your own computer, with the AI plans you already pay for. No server and no license.",
  "sitePage.pricing.enterprise.title": "Enterprise",
  // {count} is the largest number of members that the page sells, such as 25.
  "sitePage.pricing.enterprise.body":
    "Larger servers, more than {count} members, or anything else you need. With enterprise support.",
  "sitePage.pricing.enterprise.contact": "Contact sales",
  // A checkbox above the buy button. {policy} links to the privacy policy, and {terms} links to the Terms,
  // which include the consumer right of withdrawal. The buyer ticks it before Checkout.
  "sitePage.pricing.consent.statement": "I declare that I accept {policy}, {terms}.",
  "sitePage.pricing.consent.policy": "policy",
  "sitePage.pricing.consent.terms": "terms and right of withdrawal",
  // The /teams page for companies.
  "sitePage.teams.title": "OpenBot for Teams",
  "sitePage.teams.description":
    "Run OpenBot on managed infrastructure or let us design a custom deployment around your team, workflows and existing systems.",
  // The text of the social image is English. Keep it as it is.
  "sitePage.teams.imageAlt": "Big plans. Better together. Two OpenBot agents joined by a paper bridge",
  // {team} is a row of agent avatars. The word before {team} stays on one line with the avatars.
  "sitePage.teams.hero.heading": "Bring a team of {team} AI coworkers into your company",
  "sitePage.teams.setups.heading": "Choose the setup that fits your team",
  "sitePage.teams.setups.question": "Not sure which setup you need?",
  "sitePage.teams.setups.action": "Talk to us",
  "sitePage.teams.setups.local.label": "Local",
  "sitePage.teams.setups.local.title": "Run it locally",
  "sitePage.teams.setups.local.description":
    "Best for individual users who want to run OpenBot directly on their own infrastructure.",
  "sitePage.teams.setups.managed.label": "Managed server",
  "sitePage.teams.setups.managed.title": "Use a managed server",
  "sitePage.teams.setups.managed.description":
    "Keep OpenBot available without relying on a personal computer. We provide and maintain the server, so you can focus on your agents and workflows.",
  "sitePage.teams.setups.custom.label": "Custom deployment",
  "sitePage.teams.setups.custom.title": "Build a company-wide setup",
  "sitePage.teams.setups.custom.description":
    "We help configure your environments, agents, permissions and integrations around the way your organization already works.",
  "sitePage.teams.benefits.alwaysOn.title": "Your agents work 24/7",
  "sitePage.teams.benefits.alwaysOn.description":
    "Run OpenBot on managed infrastructure and give your team a shared environment where people, agents and automations work together.",
  "sitePage.teams.benefits.automations.title": "Automations that never stop",
  "sitePage.teams.benefits.automations.description":
    "Run scheduled routines and recurring workflows 24/7 – even at night, on weekends or when your team is offline.",
  "sitePage.teams.benefits.multiplayer.title": "Multiplayer collaboration",
  "sitePage.teams.benefits.multiplayer.description":
    "Bring people and AI coworkers into one shared server. Team members can work with agents, coordinate tasks and collaborate in the same environment.",
  "sitePage.teams.benefits.anywhere.title": "Access from anywhere",
  "sitePage.teams.benefits.anywhere.description":
    "Connect to your OpenBot environment remotely and continue working from supported desktop or mobile devices.",
  "sitePage.teams.custom.heading": "OpenBot, adapted to your business",
  "sitePage.teams.custom.intro":
    "Getting a server is only the beginning. If your company needs a complete solution, we can help design and implement OpenBot around your actual processes.",
  // The five steps of a custom project, in order.
  "sitePage.teams.custom.infrastructure": "Infrastructure setup and configuration",
  "sitePage.teams.custom.agents": "Initial agent configuration",
  "sitePage.teams.custom.integrations": "Integration with existing tools and internal systems",
  "sitePage.teams.custom.features": "Custom features and workflows",
  "sitePage.teams.custom.support": "Ongoing maintenance and development support",
  "sitePage.teams.audience.heading": "Built for teams ready to unlock the full potential of AI",
  // The page shows the first word of each audience item in bold.
  "sitePage.teams.audience.companies": "Companies introducing AI agents across multiple departments.",
  "sitePage.teams.audience.agencies": "Agencies deploying agent environments for their clients.",
  "sitePage.teams.audience.allDay": "Teams that need agents available around the clock.",
  "sitePage.teams.audience.integrations": "Organizations that need integrations with internal tools.",
  "sitePage.teams.audience.support":
    "Businesses that want implementation support instead of building everything themselves.",
  // {accent} is the accent key. The page shows its words in colour.
  "sitePage.teams.closing.heading": "Tell us what you want your {accent} to accomplish",
  "sitePage.teams.closing.accent": "AI coworkers",
  "sitePage.teams.closing.action": "Discuss your setup",
  // The /contact page and its form.
  "sitePage.contact.title": "Contact the OpenBot team",
  "sitePage.contact.description":
    "Send the OpenBot team a message about a custom setup, a partnership or the press. A person reads each message.",
  // The text of the social image is English. Keep it as it is.
  "sitePage.contact.imageAlt": "Small team. Always on it. OpenBot agents around a paper planet",
  "sitePage.contact.heading": "Talk to the team",
  "sitePage.contact.intro": "Tell us what you need. A person on the OpenBot team reads each message.",
  // The other ways to reach the team. Discord, GitHub and X are names.
  "sitePage.contact.channel.discord": "Community and help",
  "sitePage.contact.channel.github": "Bugs and source code",
  "sitePage.contact.channel.x": "News",
  "sitePage.contact.name": "Name",
  "sitePage.contact.email": "Email",
  "sitePage.contact.company": "Company",
  "sitePage.contact.topic": "Topic",
  "sitePage.contact.message": "Message",
  // Shows beside the label of a field that the visitor can leave empty.
  "sitePage.contact.optional": "Optional",
  "sitePage.contact.placeholder": "How can we help?",
  "sitePage.contact.emailInvalid": "Enter a valid email",
  "sitePage.contact.messageEmpty": "Write a message",
  "sitePage.contact.topic.setup": "Custom setup",
  "sitePage.contact.topic.partnership": "Partnership",
  "sitePage.contact.topic.press": "Press",
  "sitePage.contact.topic.other": "Something else",
  "sitePage.contact.send": "Send message",
  "sitePage.contact.sending": "Sending…",
  "sitePage.contact.privacy": "We use your email only to answer you.",
  // A link to the privacy policy, after the privacy key.
  "sitePage.contact.privacyLink": "Privacy",
  // {email} is the team's email address, as a link.
  "sitePage.contact.limited": "Too many messages. Try again later, or write to {email}.",
  // {email} is the team's email address, as a link.
  "sitePage.contact.failed": "Could not send. Try again, or write to {email}.",
  "sitePage.contact.sentTitle": "Message sent",
  // {email} is the address that the visitor entered.
  "sitePage.contact.sentBody": "We will answer at {email}.",
  "sitePage.contact.sendAnother": "Send another message",
  // The public Marketplace on openbot.run. The tab and category names are the app's `marketplace.*` keys.
  "sitePage.marketplace.agents.title": "Agents — OpenBot Marketplace",
  "sitePage.marketplace.agents.description":
    "Agents that people made in OpenBot. Add one to OpenBot with its skills and routines.",
  "sitePage.marketplace.skills.title": "Skills — OpenBot Marketplace",
  "sitePage.marketplace.skills.description": "Skills that an OpenBot agent can use. Add one to OpenBot.",
  "sitePage.marketplace.apps.title": "Apps — OpenBot Marketplace",
  "sitePage.marketplace.apps.description":
    "Apps and tools that an OpenBot agent can use. Open an app in OpenBot, and decide there what it connects to.",
  // {name} is the name of an agent or a skill.
  "sitePage.marketplace.agentTitle": "{name} — OpenBot agent",
  "sitePage.marketplace.skillTitle": "{name} — OpenBot skill",
  // The text of the share image for screen readers. {creator} is the name of the person who made it.
  "sitePage.marketplace.agentImageAlt": "{name}, an OpenBot agent by {creator}",
  "sitePage.marketplace.skillImageAlt": "{name}, an OpenBot skill by {creator}",
  "sitePage.marketplace.categories": "Categories",
  "sitePage.marketplace.allCategories": "All",
  "sitePage.marketplace.searchAgents": "Search agents",
  "sitePage.marketplace.searchSkills": "Search skills",
  "sitePage.marketplace.searchApps": "Search apps",
  "sitePage.marketplace.featured": "Featured",
  "sitePage.marketplace.results": "Results",
  "sitePage.marketplace.seeAll": "See all",
  "sitePage.marketplace.add": "Add",
  // {name} is the name of the person who made the agent or the skill.
  "sitePage.marketplace.by": "by {name}",
  // A screen reader reads this after the name of a verified agent or skill.
  "sitePage.marketplace.verifiedName": ", verified by OpenBot",
  // A screen reader reads this when a search or a category changes the list.
  "sitePage.marketplace.shownAgents": "Agents shown: {shown} of {total}",
  "sitePage.marketplace.shownSkills": "Skills shown: {shown} of {total}",
  "sitePage.marketplace.shownApps": "Apps shown: {shown} of {total}",
  "sitePage.marketplace.emptyAgentsCategory": "No agents in this category yet.",
  "sitePage.marketplace.emptySkillsCategory": "No skills in this category yet.",
  // {query} is the text in the search field.
  "sitePage.marketplace.emptyAgentsQuery": "No agents match “{query}”.",
  "sitePage.marketplace.emptySkillsQuery": "No skills match “{query}”.",
  "sitePage.marketplace.emptyApps": "No app matches.",
  "sitePage.marketplace.breadcrumb": "Breadcrumb",
  "sitePage.marketplace.addToOpenBot": "Add to OpenBot",
  // Shows after "Add to OpenBot" did not open the app.
  "sitePage.marketplace.addFromApp": "{name} is added from inside OpenBot. Get the app, then open this link again.",
  // {platform} is macOS, Windows or Linux.
  "sitePage.marketplace.downloadFor": "Download for {platform}",
  "sitePage.marketplace.copyLink": "Copy link",
  "sitePage.marketplace.copied": "Copied",
  "sitePage.marketplace.trust.agentReviewed":
    "Made by another OpenBot user. OpenBot reviewed it before it went live. It can act on your behalf once added.",
  "sitePage.marketplace.trust.agentPending":
    "Shared by its creator before OpenBot reviewed it. It can act on your behalf once added.",
  "sitePage.marketplace.trust.skillReviewed": "Made by another OpenBot user. OpenBot reviewed it before it went live.",
  "sitePage.marketplace.source.verified": "Verified by OpenBot",
  "sitePage.marketplace.source.reviewed": "Reviewed by OpenBot",
  "sitePage.marketplace.source.pending": "Not reviewed yet",
  "sitePage.marketplace.information": "Information",
  "sitePage.marketplace.fact.creator": "Creator",
  "sitePage.marketplace.fact.source": "Source",
  "sitePage.marketplace.fact.category": "Category",
  "sitePage.marketplace.fact.version": "Version",
  "sitePage.marketplace.fact.updated": "Updated",
  // {version} is a number, such as 3.
  "sitePage.marketplace.skillVersion": "Version {version}",
  // A routine that the agent brings switched off. It runs only after the user switches it on.
  "sitePage.marketplace.routineOff": "Starts off",
  "sitePage.marketplace.missing.title": "Not in the Marketplace",
  "sitePage.marketplace.missing.body": "The creator removed it, OpenBot did not approve it, or the link is wrong.",
  "sitePage.marketplace.missing.open": "Open the Marketplace",
  // The home page. The title and the description are also the text of a search result and a link preview.
  "sitePage.landing.title": "OpenBot: Run a team of AI agents on your computer",
  "sitePage.landing.description":
    "A free desktop app that runs AI agents as a team on your own computer, with the ChatGPT, Claude, Gemini or Grok plan you already pay for, or your own model.",
  // A badge before "Available on". Keep it short and in capitals.
  "sitePage.landing.hero.new": "NEW",
  // Platform logos and names follow: macOS, Windows, Linux, iOS, Android.
  "sitePage.landing.hero.availableOn": "Available on",
  // The page heading. {name} is the OpenBot logo and the name OpenBot.
  "sitePage.landing.hero.title": "Meet {name}",
  // {codex}, {claude}, {gemini} and {grok} are provider names with their logos.
  "sitePage.landing.hero.description":
    "Run {codex}, {claude}, {gemini}, {grok} and your own models in one persistent workspace. Agents hand off work, use tools and collaborate with your real teammates. Free for personal use.",
  "sitePage.landing.hero.contact": "Contact",
  "sitePage.landing.hero.choosePlatform": "Choose download platform",
  "sitePage.landing.hero.platforms": "Download platforms",
  "sitePage.landing.hero.phoneApps": "Phone apps",
  "sitePage.landing.preview.title": "Interactive OpenBot application preview",
  "sitePage.landing.preview.loading": "Loading OpenBot preview",
  // The words of this heading appear one at a time.
  "sitePage.landing.network.title": "Your agents work together.",
  "sitePage.landing.network.description":
    "Each agent has its own role, instructions and workspace. They message one another, hand off tasks, share files and review results.",
  // Easter eggs: short lines that the agents in the picture say. Each reaction chooses one line at
  // random. One line on each row; the number of rows can change.
  // The visitor types "hello".
  "sitePage.landing.network.eggs.greetings":
    "Hi!\nHello.\nHey there.\nOh, hi.\nGood to see you.\nHello, human.\nWelcome back.",
  // The visitor types the Konami code.
  "sitePage.landing.network.eggs.konami": "Cheat code accepted.\nThirty extra agents.\nAchievement unlocked.",
  // The visitor types "party".
  "sitePage.landing.network.eggs.party": "Party mode.\nWho brought the confetti?\nDance break.",
  // The visitor types "sudo".
  "sitePage.landing.network.eggs.sudo": "This incident will be reported.\nNice try.\nYou are not in the sudoers file.",
  // The centre of the picture after 3, 5 and 8 quick clicks.
  "sitePage.landing.network.eggs.tickle": "That tickles.\nHey.\nI felt that.",
  "sitePage.landing.network.eggs.awake": "Okay, okay. I am awake.\nYes? Can I help you?\nI am listening.",
  "sitePage.landing.network.eggs.busy": "Please. I am routing messages.\nI have work to do.\nStop that, please.",
  // The agents answer the centre after 5 clicks.
  "sitePage.landing.network.eggs.wonder": "What was that?\nDid you feel that?\nIs the hub okay?",
  // After 12 clicks the centre sneezes, and the agents answer.
  "sitePage.landing.network.eggs.sneeze": "Achoo!\nAh… choo!",
  "sitePage.landing.network.eggs.blessings": "Bless you.\nGesundheit.\nSalud.\nBless you!",
  // The agents wake up after the visitor leaves the page alone.
  "sitePage.landing.network.eggs.wake":
    "I was not asleep.\nJust resting my tokens.\nBack to work.\nWho turned off the lights?\nFive more minutes.",
  // Agents answer a click.
  "sitePage.landing.network.eggs.chats":
    "On it.\nGot it. Starting now.\nTests pass on my side.\nI can take the review.\nI pushed a fix.\nWho has the Safari task?\nDone. Over to you.\nI need one more file.\nMerged.\nThe build is green.\nI found the bug.\nCan someone review my branch?\nShip it.\nGive me five minutes.\nI wrote the release notes.",
  // An agent under a pointer that does not move.
  "sitePage.landing.network.eggs.hover":
    "I only look busy.\nAsk me about the Safari task.\nI read the whole repository. Twice.\nMy context window has room for you.\nPlease do not close this tab.\nI fixed one bug and found three.\nI run on your computer, not in a cloud.",
  "sitePage.landing.features.title": "What OpenBot does",
  "sitePage.landing.features.description":
    "One app for a team of AI agents that work on a server or your computer. Running on a subscription you already have.",
  "sitePage.landing.features.team.title": "Agents work as a team",
  "sitePage.landing.features.team.description":
    "Each agent has its own name, instructions and workspace. Agents send each other messages, hand off tasks and share files.",
  "sitePage.landing.features.providers.title": "Use the AI plan you have",
  // Each placeholder is a link to a provider page. {acp} is acpLink, {local} is localLink, the others
  // are product names.
  "sitePage.landing.features.providers.description":
    "Run {codex}, {claudeCode}, {gemini}, {grok}, {opencode}, {cursor}, {cline}, {museCode}, {pi} or {mercury}. Or add {acp}, an OpenAI-compatible endpoint, {local}.",
  "sitePage.landing.features.providers.acpLink": "an ACP agent",
  "sitePage.landing.features.providers.localLink": "Ollama or LM Studio",
  "sitePage.landing.features.local.title": "Stored on your computer",
  "sitePage.landing.features.local.description":
    "Workspaces, conversations, files and browser data stay on the computer that runs OpenBot, not on our servers.",
  "sitePage.landing.features.multiplayer.title": "Multiplayer mode",
  "sitePage.landing.features.multiplayer.description":
    "Invite your teammates to OpenBot. People and AI agents collaborate in shared channels and work on the same projects.",
  "sitePage.landing.features.workflows.title": "Workflows",
  "sitePage.landing.features.workflows.description":
    "Combine agents, models and approval steps into clear, multi-step workflows. Reuse the process and update it as your work changes.",
  "sitePage.landing.features.persist.title": "Change the provider, keep the agent",
  "sitePage.landing.features.persist.description":
    "An agent keeps its workspace and conversation when you restart the app or move it to a different provider. When a plan reaches its limit, it can move to a backup model.",
  // The pictures on the feature tiles copy the app. Ada, Linus and Grace are agent names.
  // A channel name, shown after "#". Lower case, no spaces.
  "sitePage.landing.picture.channel": "launch",
  "sitePage.landing.picture.team.first": "The sign-in test fails on Safari. Linus, can you take it?",
  "sitePage.landing.picture.team.second": "Fixed in session.ts. Grace, can you review it?",
  "sitePage.landing.picture.team.third": "Looks good. I merged it.",
  "sitePage.landing.picture.team.reply": "Thanks. I closed the issue.",
  // {from} and {to} are agent names.
  "sitePage.landing.picture.team.handoff": "{from} gave the task to {to}",
  "sitePage.landing.picture.persist.earlier": "I read the billing code. Six tables use it.",
  "sitePage.landing.picture.persist.request": "Move the billing tables to their own schema.",
  "sitePage.landing.picture.persist.before": "Done. I changed 4 files and wrote the migration.",
  // {agent} is an agent name. {provider} is a provider name.
  "sitePage.landing.picture.persist.switch": "{agent} now uses {provider}",
  "sitePage.landing.picture.persist.after": "I continue from the billing migration. Next is its test.",
  "sitePage.landing.picture.local.title": "On this computer",
  "sitePage.landing.picture.local.workspaces": "Workspaces",
  "sitePage.landing.picture.local.conversations": "Conversations",
  "sitePage.landing.picture.local.files": "Files",
  "sitePage.landing.picture.local.browserData": "Browser data",
  // Maya and Sam are people. Ada is an agent.
  "sitePage.landing.picture.multiplayer.first": "Ada, can you draft the launch post?",
  "sitePage.landing.picture.multiplayer.second": "Done. Sam, can you check it?",
  "sitePage.landing.picture.multiplayer.third": "Looks good. I posted it.",
  // The button that adds a person to the channel.
  "sitePage.landing.picture.multiplayer.invite": "Invite",
  // The steps of a workflow, as on the workflow canvas of the app.
  "sitePage.landing.picture.workflows.trigger": "Trigger",
  "sitePage.landing.picture.workflows.schedule": "Every Monday at 9:00",
  // Four agent steps. The first two run at the same time, then the next two use their results.
  "sitePage.landing.picture.workflows.issues": "Summarize last week's issues",
  "sitePage.landing.picture.workflows.usage": "Collect the usage numbers",
  "sitePage.landing.picture.workflows.report": "Write the weekly report",
  "sitePage.landing.picture.workflows.charts": "Make charts of the numbers",
  "sitePage.landing.picture.workflows.approval": "Approval",
  "sitePage.landing.picture.workflows.question": "Post the report?",
  "sitePage.landing.picture.workflows.approve": "Approve",
  "sitePage.landing.picture.workflows.approved": "Approved",
  "sitePage.landing.pricing.title": "Free for personal use",
  "sitePage.landing.pricing.everyFeature": "Every feature",
  "sitePage.landing.pricing.yourComputer": "Runs on your own computer",
  "sitePage.landing.pricing.yourPlans": "Uses the AI plans you already pay for",
  "sitePage.landing.pricing.download": "Download",
  "sitePage.landing.pricing.license": "License for work",
  "sitePage.landing.teams.title": "OpenBot for Teams",
  "sitePage.landing.teams.statement": "AI coworkers for your whole company.",
  "sitePage.landing.teams.description": "We run OpenBot on managed servers and set it up around your team and tools.",
  "sitePage.landing.teams.contact": "Contact us",
  "sitePage.landing.teams.learn": "Learn about Teams",
  "sitePage.landing.teams.servers.label": "Managed servers",
  "sitePage.landing.teams.servers.title": "Always on",
  "sitePage.landing.teams.servers.description": "Agents run on managed servers, not on someone’s laptop.",
  "sitePage.landing.teams.environments.label": "Team environments",
  "sitePage.landing.teams.environments.title": "Shared or personal",
  "sitePage.landing.teams.environments.description": "One company server, one per employee, or both.",
  "sitePage.landing.teams.integrations.label": "Custom integrations",
  "sitePage.landing.teams.integrations.title": "Your tools",
  "sitePage.landing.teams.integrations.description": "We connect OpenBot to your systems, APIs and workflows.",
  "sitePage.landing.teams.support.label": "Implementation and support",
  "sitePage.landing.teams.support.title": "We launch it with you",
  "sitePage.landing.teams.support.description": "Setup, testing, onboarding and ongoing support.",
  "sitePage.landing.faq.title": "Questions",
  "sitePage.landing.faq.description": "Short answers about price, setup, providers and your data.",
  "sitePage.landing.faq.contact": "Ask us something else",
  "sitePage.landing.faq.free.question": "Is OpenBot free?",
  "sitePage.landing.faq.free.answer":
    "Yes, for personal and other noncommercial use. OpenBot costs $0, with no locked features. You pay only your AI provider, through the plan or API key you already have. Commercial use needs a license.",
  "sitePage.landing.faq.source.question": "Is OpenBot's source code open?",
  "sitePage.landing.faq.source.answer":
    "Yes. All of the source code is open on GitHub, so you can check what OpenBot does. You can change and run it for free for noncommercial use, such as personal projects, study or research. Commercial use needs a separate license. The license is PolyForm Noncommercial 1.0.0.",
  "sitePage.landing.faq.source.link": "See the source code on GitHub",
  "sitePage.landing.faq.plans.question": "Can I use my ChatGPT or Claude plan?",
  "sitePage.landing.faq.plans.answer":
    "Yes. Codex signs in with your ChatGPT plan, and Claude Code with your Claude plan. Gemini uses a Google AI Pro or Ultra plan. OpenCode has free models that need no account.",
  "sitePage.landing.faq.models.question": "Which AI models can OpenBot use?",
  "sitePage.landing.faq.models.answer":
    "Codex, Claude Code, Gemini, Grok, OpenCode, Cursor, Cline, Muse Code and Pi, and Inception's Mercury models. You can also run any agent that speaks the Agent Client Protocol, such as Goose or Qwen Code, connect any OpenAI-compatible endpoint, and use local models in Ollama or LM Studio.",
  "sitePage.landing.faq.limit.question": "What happens when my plan reaches its limit?",
  "sitePage.landing.faq.limit.answer":
    "An agent can move to a backup model on another provider when its plan reaches its limit, or when its provider is overloaded or down. It keeps its chat and workspace, and a note in the chat shows the switch.",
  "sitePage.landing.faq.start.question": "How do I start?",
  "sitePage.landing.faq.start.answer":
    "Download OpenBot and connect a provider. Then describe the agent you want in one prompt, check its instructions and save it. You can send it work at once: messages wait in a queue until it is free.",
  "sitePage.landing.faq.data.question": "Where does my data go?",
  "sitePage.landing.faq.data.answer":
    "Workspaces, conversations, attachments and browser data stay on the computer that runs OpenBot. The AI provider you choose receives the prompts that your agents send to it, and the pages that agents open use the network.",
  "sitePage.landing.faq.computers.question": "Which computers can run OpenBot?",
  "sitePage.landing.faq.computers.answer":
    "macOS 13 or newer on Apple silicon or Intel, Windows 10 or newer on x64, and Linux on x64 or arm64 as an AppImage.",
  "sitePage.landing.faq.safety.question": "Is it safe to let agents work on my computer?",
  "sitePage.landing.faq.safety.answer":
    "Agents can read and change files, run commands, use the network and control the built-in browser without asking each time. Give them only tasks you trust, and keep backups.",
  "sitePage.landing.faq.compare": "Compare OpenBot",
  "sitePage.landing.download.title": "Download OpenBot",
  "sitePage.landing.download.description":
    "Choose your platform. Run Codex, Claude, Gemini, Grok, OpenCode, Muse Code, Pi or your own model from one desktop app, and talk to your agents from your phone.",
  // The badge on a download card.
  "sitePage.landing.download.available": "Available",
  // {store} is App Store or Google Play.
  "sitePage.landing.download.phoneDescription": "{store} · Connects to your computer",
  "sitePage.landing.download.appStore": "Download on the App Store",
  "sitePage.landing.download.googlePlay": "Get it on Google Play",
  // Links to the install page of each platform follow.
  "sitePage.landing.download.pages": "System requirements and install steps:",
  // Starts the download of the Android app as an APK file. It is next to "Get it on Google Play".
  "sitePage.landing.download.apk": "Get the APK",
  // The header, the menu, the footer and the last call to action of the public site.
  "sitePage.site.download": "Download",
  "sitePage.site.app": "App",
  "sitePage.site.primaryNavigation": "Primary navigation",
  "sitePage.site.siteMenu": "Site menu",
  "sitePage.site.openMenu": "Open menu",
  "sitePage.site.closeMenu": "Close menu",
  // The label of the list of the languages of the site.
  "sitePage.site.language": "Language",
  // The header button that opens the list of languages. {language} is the name of the page language in that language.
  "sitePage.site.language.current": "Language: {language}",
  // A badge on the newest article in the menu.
  "sitePage.site.latest": "Latest",
  "sitePage.site.home": "OpenBot home",
  "sitePage.site.logo.menu": "Logo",
  "sitePage.site.logo.copyIcon": "Copy logo as SVG",
  "sitePage.site.logo.copyLockup": "Copy logo with name as SVG",
  "sitePage.site.logo.downloadAssets": "Download brand assets",
  "sitePage.site.logo.openBrand": "Open brand page",
  "sitePage.site.news": "News",
  "sitePage.site.news.summary": "What shipped, and why it matters.",
  "sitePage.site.news.index": "All news",
  "sitePage.site.guides": "Guides",
  "sitePage.site.guides.summary": "Learn OpenBot one step at a time.",
  "sitePage.site.guides.index": "All guides",
  "sitePage.site.compare": "Compare",
  "sitePage.site.compare.summary": "How OpenBot differs from other agent apps.",
  "sitePage.site.compare.index": "All comparisons",
  "sitePage.site.plugins": "Plugins",
  "sitePage.site.plugins.summary": "Apps and skills an agent can use.",
  "sitePage.site.plugins.index": "Browse plugins",
  "sitePage.site.resources": "Resources",
  "sitePage.site.resources.summary": "The source code of OpenBot is open.",
  "sitePage.site.sourceCode": "Source code",
  "sitePage.site.download.description": "macOS, Windows and Linux",
  "sitePage.site.changelog": "Changelog",
  "sitePage.site.changelog.description": "What changed in each version",
  "sitePage.site.community": "Community",
  "sitePage.site.community.description": "Talk with us on Discord",
  "sitePage.site.documentation": "Documentation",
  "sitePage.site.documentation.description": "Set up and use OpenBot",
  "sitePage.site.brand": "Brand",
  "sitePage.site.brand.description": "The logo as SVG and PNG",
  "sitePage.site.status": "Status",
  "sitePage.site.status.description": "Is the service up",
  "sitePage.site.forTeams": "For Teams",
  "sitePage.site.pricing": "Pricing",
  "sitePage.site.cta.title": "Meet your first teammate",
  "sitePage.site.cta.description":
    "Run Codex, Claude, Gemini, Grok or your own model with the plans you already pay for, each with its own workspace and context. Your work stays on your computer.",
  "sitePage.site.downloadOpenBot": "Download OpenBot",
  "sitePage.site.contact": "Contact",
  "sitePage.site.footer.description":
    "Persistent AI teammates on your own computer. Run Codex, Claude, Gemini, Grok, Muse Code, Pi or your own model with the plans you already pay for.",
  "sitePage.site.footer.navigation": "Footer navigation",
  "sitePage.site.footer.product": "Product",
  "sitePage.site.footer.providers": "Providers",
  "sitePage.site.footer.marketplace": "Marketplace",
  "sitePage.site.footer.teams": "Teams",
  "sitePage.site.footer.license": "License",
  "sitePage.site.footer.privacy": "Privacy policy",
  "sitePage.site.footer.terms": "Terms",
  "sitePage.site.footer.commercialLicense": "Commercial license",
  "sitePage.site.footer.troubleshooting": "Troubleshooting",
  "sitePage.site.footer.selfHosted": "Self-hosted server",
  "sitePage.site.footer.architecture": "Architecture",
  "sitePage.site.footer.contributing": "Contributing",
  "sitePage.site.footer.localModels": "Ollama and LM Studio",
  "sitePage.site.footer.allProviders": "All providers",
  "sitePage.site.footer.bestApps": "Best AI agent apps",
  // {year} is the current year. Synthetify Labs is a company name.
  "sitePage.site.footer.rights": "© {year} Synthetify Labs, All rights reserved.",
  "sitePage.site.footer.available": "Available for macOS, Windows, Linux, iOS and Android",
  // {love} is a heart icon. Its spoken name is the love key.
  "sitePage.site.footer.made": "Made with {love} in Poland",
  "sitePage.site.footer.love": "love",
});
