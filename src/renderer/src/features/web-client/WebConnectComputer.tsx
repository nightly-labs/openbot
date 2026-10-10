import { AppLogo } from "@openbot/brand";
import { Button, buttonVariants, Download, ErrorReference, Heading, Link2, RefreshCw, Text } from "@openbot/ui";
import { useText } from "@openbot/ui/text";

/** The first screen of the web client when the account has no computer to connect to. */
export function WebConnectComputer(props: {
  loading: boolean;
  failed: boolean;
  /** The code of the failed host list read. */
  reference?: string | null;
  onJoin: () => void;
  onRefresh: () => void;
}) {
  const { t } = useText();
  return (
    <section class="conversation-panel web-connect" aria-labelledby="web-connect-title">
      <div class="web-connect-card">
        <header class="web-connect-header">
          <AppLogo variant="production" class="web-connect-logo" />
          <Heading as="h2" size="lg" id="web-connect-title">
            {props.failed ? t("webClient.notice.hostsFailed") : t("webClient.notice.connectComputer")}
          </Heading>
          <Text tone="muted">{t("webClient.connect.description")}</Text>
          <ErrorReference reference={props.failed ? props.reference : null} />
        </header>

        <ol class="web-connect-steps">
          <li>
            <span class="web-connect-step-number" aria-hidden="true">
              1
            </span>
            <Text>{t("webClient.connect.stepInstall")}</Text>
          </li>
          <li>
            <span class="web-connect-step-number" aria-hidden="true">
              2
            </span>
            <Text>{t("webClient.connect.stepSignIn")}</Text>
          </li>
          <li>
            <span class="web-connect-step-number" aria-hidden="true">
              3
            </span>
            <Text>{t("webClient.connect.stepRemote")}</Text>
          </li>
        </ol>

        <footer class="web-connect-actions">
          <div class="web-connect-primary-actions">
            <a
              class={`web-connect-download ${buttonVariants({ variant: "default" })}`}
              href="/#download"
              target="_blank"
              rel="noreferrer"
            >
              <Download aria-hidden="true" />
              {t("webClient.notice.download")}
            </a>
            <Button variant="outline" onClick={() => props.onJoin()}>
              <Link2 aria-hidden="true" />
              {t("webClient.notice.join")}
            </Button>
          </div>
          <Button
            class="web-connect-refresh"
            variant="ghost"
            size="sm"
            loading={props.loading}
            loadingLabel={t("webClient.notice.findingHosts")}
            onClick={() => props.onRefresh()}
          >
            <RefreshCw aria-hidden="true" />
            {t("webClient.notice.refreshHosts")}
          </Button>
        </footer>
      </div>
    </section>
  );
}
