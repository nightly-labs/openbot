import { AppLogo } from "@openbot/brand";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Button,
  buttonVariants,
  Download,
  Heading,
  Link2,
  OctagonX,
  RefreshCw,
  Text,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";

/** The first screen of the web client when the account has no computer to connect to. */
export function WebConnectComputer(props: {
  loading: boolean;
  error: string | null;
  onJoin: () => void;
  onRefresh: () => void;
}) {
  const { t, sourceText } = useText();
  return (
    <section class="conversation-panel web-connect" aria-labelledby="web-connect-title">
      <div class="web-connect-card">
        <header class="web-connect-header">
          <AppLogo variant="production" class="web-connect-logo" />
          <Heading as="h2" size="lg" id="web-connect-title">
            {props.error ? t("webClient.notice.hostsFailed") : t("webClient.notice.connectComputer")}
          </Heading>
          <Text tone="muted">{t("webClient.connect.description")}</Text>
        </header>

        <Show when={props.error}>
          {(error) => (
            <Alert tone="danger" role="alert">
              <AlertIcon>
                <OctagonX />
              </AlertIcon>
              <AlertContent>
                <AlertDescription>{sourceText(error())}</AlertDescription>
              </AlertContent>
            </Alert>
          )}
        </Show>

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
            <a class={buttonVariants({ variant: "default" })} href="/#download" target="_blank" rel="noreferrer">
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
