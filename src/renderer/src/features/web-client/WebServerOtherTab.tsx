import { AppLogo } from "@openbot/brand";
import { Button, Heading, Text } from "@openbot/ui";
import { useText } from "@openbot/ui/text";

/** Fills the window when another tab of this browser has the server open. "Use here" moves it to this tab. */
export function WebServerOtherTab(props: { name: string; busy: boolean; onUseHere: () => void }) {
  const { t } = useText();
  return (
    <main class="conversation-panel web-connect web-other-tab" aria-labelledby="web-other-tab-title">
      <div class="web-connect-card">
        <header class="web-connect-header">
          <AppLogo variant="production" class="web-connect-logo" />
          <Heading as="h1" size="lg" id="web-other-tab-title">
            {t("webClient.otherTab.title", { name: props.name })}
          </Heading>
          <Text tone="muted">{t("webClient.otherTab.description")}</Text>
        </header>
        <footer class="web-connect-actions">
          <Button
            class="web-other-tab-use"
            loading={props.busy}
            loadingLabel={t("webClient.notice.connecting")}
            onClick={() => props.onUseHere()}
          >
            {t("webClient.otherTab.useHere")}
          </Button>
        </footer>
      </div>
    </main>
  );
}
