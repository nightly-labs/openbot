import type { BrowserDockIsland, LocalBrowserSecretResponse } from "@openbot/contracts/ipc";
import { Button, LoaderCircle, MousePointer2, X } from "@openbot/ui";
import { QuestionPromptBubble } from "@openbot/ui/components/QuestionPromptBubble";
import type { ComposerAgent } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { BrowserSecretCard, type BrowserSecretVault } from "@openbot/ui/features/conversation/BrowserSecretCard";
import { ApprovalCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import { RichMessageText } from "@openbot/ui/features/conversation/RichMessageText";
import type { SendShortcut } from "@openbot/ui/features/conversation/send-shortcut";
import { useText } from "@openbot/ui/text";
import { Match, Show, Switch } from "solid-js";

export type BrowserIslandContent = BrowserDockIsland;

export function browserIslandKey(content: BrowserIslandContent | null): string {
  if (!content) return "";
  switch (content.kind) {
    case "activity":
      return content.control === "agent" ? `activity:agent:${content.label}` : `activity:${content.control}`;
    case "secret":
      return `secret:${content.request.requestId}`;
    case "prompt":
      return `prompt:${content.requestId}:${content.attempt}`;
    case "approval":
      return `approval:${content.approval.requestId}:${content.attempt}`;
    case "reply":
      return `reply:${content.id}`;
  }
}

export interface BrowserIslandFaceProps {
  content: BrowserIslandContent;
  agent: ComposerAgent;
  agents: ComposerAgent[];
  handoffPending?: boolean | undefined;
  sendShortcut?: SendShortcut | undefined;
  onHandoff?: (() => void) | undefined;
  vault?: BrowserSecretVault | undefined;
  onRespondSecret: (input: LocalBrowserSecretResponse) => Promise<void>;
  onAnswerPrompt: (requestId: string | number, answers: Record<string, string[]>) => Promise<boolean>;
  onRespondApproval: (requestId: string | number, decision: "accept" | "decline") => Promise<boolean>;
  onDismissReply: (id: string) => void;
  onOpenChat?: (() => void) | undefined;
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
  statusRef?: ((element: HTMLSpanElement) => void) | undefined;
}

export function BrowserIslandFace(props: BrowserIslandFaceProps) {
  const { t } = useText();
  const activity = () => (props.content.kind === "activity" ? props.content : undefined);
  const secret = () => (props.content.kind === "secret" ? props.content : undefined);
  const prompt = () => (props.content.kind === "prompt" ? props.content : undefined);
  const approval = () => (props.content.kind === "approval" ? props.content : undefined);
  const reply = () => (props.content.kind === "reply" ? props.content : undefined);
  const statusText = () => {
    const current = activity();
    if (!current) return "";
    if (current.control === "agent") return current.label;
    return current.control === "user"
      ? t("browser.userControl.status")
      : t("browser.dock.needsYou", { name: props.agent.name });
  };
  return (
    <Switch>
      <Match when={activity()}>
        {(current) => (
          <div class="browser-dock-island-face browser-dock-island-activity">
            <output class="browser-dock-status">
              <Show when={current().control === "agent"} fallback={<MousePointer2 aria-hidden="true" />}>
                <LoaderCircle class="browser-dock-spin" aria-hidden="true" />
              </Show>
              <span ref={(element) => props.statusRef?.(element)}>{statusText()}</span>
            </output>
            <Show when={props.onHandoff}>
              {(handoff) => (
                <Button
                  variant="ghost"
                  size="xs"
                  class="browser-dock-handoff"
                  loading={props.handoffPending === true}
                  onClick={() => handoff()()}
                >
                  {current().control === "agent" ? t("island.action.takeOver") : t("prompt.browser.done")}
                </Button>
              )}
            </Show>
          </div>
        )}
      </Match>
      <Match when={secret()}>
        {(current) => (
          <div class="browser-dock-island-face">
            <BrowserSecretCard
              variant="island"
              request={current().request}
              vault={props.vault}
              onRespond={props.onRespondSecret}
            />
          </div>
        )}
      </Match>
      <Match when={prompt()}>
        {(current) => (
          <section
            class="browser-dock-island-face browser-dock-island-card"
            aria-label={t("browser.dock.needsAnswer", { name: props.agent.name })}
          >
            <header class="browser-dock-reply-header">
              <AgentAvatar agent={props.agent} class="browser-dock-avatar" />
              <strong>{t("browser.dock.needsAnswer", { name: props.agent.name })}</strong>
            </header>
            <Show keyed when={browserIslandKey(current())}>
              {(_attempt) => (
                <QuestionPromptBubble
                  questions={current().questions}
                  sendShortcut={props.sendShortcut}
                  onSubmit={(answers) => props.onAnswerPrompt(current().requestId, answers)}
                  onOpenLink={props.onOpenLink}
                />
              )}
            </Show>
          </section>
        )}
      </Match>
      <Match when={approval()}>
        {(current) => (
          <section
            class="browser-dock-island-face browser-dock-island-card"
            aria-label={t("browser.dock.needsApproval", { name: props.agent.name })}
          >
            <header class="browser-dock-reply-header">
              <AgentAvatar agent={props.agent} class="browser-dock-avatar" />
              <strong>{t("browser.dock.needsApproval", { name: props.agent.name })}</strong>
            </header>
            <Show keyed when={browserIslandKey(current())}>
              {(_attempt) => (
                <ApprovalCard
                  approval={current().approval}
                  onApprove={() => props.onRespondApproval(current().approval.requestId, "accept")}
                  onReject={() => props.onRespondApproval(current().approval.requestId, "decline")}
                />
              )}
            </Show>
          </section>
        )}
      </Match>
      <Match when={reply()}>
        {(current) => (
          <div
            class="browser-dock-island-face browser-dock-island-reply"
            role="status"
            aria-label={t("chat.row.label", { name: props.agent.name })}
          >
            <header class="browser-dock-reply-header">
              <AgentAvatar agent={props.agent} class="browser-dock-avatar" />
              <strong>{props.agent.name}</strong>
              <Button
                variant="ghost"
                size="icon-xs"
                class="browser-dock-reply-close"
                aria-label={t("island.action.dismiss")}
                onClick={() => props.onDismissReply(current().id)}
              >
                <X aria-hidden="true" />
              </Button>
            </header>
            <div class="browser-dock-reply-body">
              <RichMessageText
                body={current().body}
                agents={props.agents}
                onSelectAgent={props.onSelectAgent}
                onOpenLink={props.onOpenLink}
              />
            </div>
            <Show when={current().answerInChat && props.onOpenChat}>
              {(openChat) => (
                <div class="browser-dock-reply-actions">
                  <Button variant="secondary" size="xs" onClick={() => openChat()()}>
                    {t("browser.dock.answerInChat")}
                  </Button>
                </div>
              )}
            </Show>
          </div>
        )}
      </Match>
    </Switch>
  );
}
