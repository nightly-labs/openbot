import {
  Button,
  ConfirmDialog,
  ErrorReference,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Text,
} from "@openbot/ui";
import { errorReference, type UserErrorDetails } from "@openbot/user-errors";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";

/**
 * "New conversation" and "Compact now" for a channel, as the agent settings offer them for an
 * agent's own chat. A new conversation asks first; its failure stays in the dialog. A compaction
 * failure shows under its row.
 */
export function ChannelContextActions(props: {
  channelName: string;
  startNewConversation: () => Promise<void>;
  compact: () => Promise<void>;
}) {
  const { t, errorMessage } = useText();
  const [confirmOpen, setConfirmOpen] = createSignal(false);
  const [confirmFailure, setConfirmFailure] = createSignal<UserErrorDetails | null>(null);
  const [compacting, setCompacting] = createSignal(false);
  const [compactFailure, setCompactFailure] = createSignal<UserErrorDetails | null>(null);
  let newConversationButton: HTMLButtonElement | undefined;

  async function confirm(): Promise<void> {
    setConfirmFailure(null);
    try {
      await props.startNewConversation();
      setConfirmOpen(false);
    } catch (error) {
      setConfirmFailure({
        message: errorMessage(error, t("channel.settings.newConversation.failed")),
        reference: errorReference(error),
      });
    }
  }

  async function compact(): Promise<void> {
    setCompactFailure(null);
    setCompacting(true);
    try {
      await props.compact();
    } catch (error) {
      setCompactFailure({
        message: errorMessage(error, t("channel.settings.compact.failed")),
        reference: errorReference(error),
      });
    } finally {
      setCompacting(false);
    }
  }

  return (
    <>
      <ItemGroup class="channel-context-actions">
        <Item>
          <ItemContent>
            <ItemTitle>{t("channel.settings.newConversation.title")}</ItemTitle>
            <ItemDescription>{t("channel.settings.newConversation.description")}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              ref={newConversationButton}
              size="sm"
              variant="outline"
              type="button"
              aria-label={t("channel.settings.newConversation.confirm")}
              aria-haspopup="dialog"
              onClick={() => setConfirmOpen(true)}
            >
              {t("channel.settings.newConversation.button")}
            </Button>
          </ItemActions>
        </Item>
        <Item>
          <ItemContent>
            <ItemTitle>{t("channel.settings.compact.title")}</ItemTitle>
            <ItemDescription>{t("channel.settings.compact.description")}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button size="sm" variant="outline" type="button" disabled={compacting()} onClick={() => void compact()}>
              {t("composer.context.compact")}
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>
      <Show when={compactFailure()}>
        {(failure) => (
          <Text as="p" variant="caption" tone="danger" role="alert">
            {failure().message}
            <ErrorReference reference={failure().reference} />
          </Text>
        )}
      </Show>
      <ConfirmDialog
        open={confirmOpen()}
        tone="default"
        initialFocus="cancel"
        title={t("channel.settings.newConversation.confirmTitle", { name: props.channelName })}
        description={t("channel.settings.newConversation.confirmDescription")}
        confirmLabel={t("channel.settings.newConversation.confirm")}
        error={
          confirmFailure() ? (
            <>
              {confirmFailure()?.message}
              <ErrorReference reference={confirmFailure()?.reference} />
            </>
          ) : undefined
        }
        restoreFocusTarget={newConversationButton}
        onCancel={() => {
          setConfirmFailure(null);
          setConfirmOpen(false);
        }}
        onConfirm={confirm}
      />
    </>
  );
}
