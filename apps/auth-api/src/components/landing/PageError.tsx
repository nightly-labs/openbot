import type { PageErrorText } from "../transactional/page-text";
import { TransactionalPage } from "../transactional/TransactionalPage";
import { Button } from "../ui/button";

export function PageError(props: { lang: string; text: PageErrorText; onRetry: () => void }) {
  return (
    <TransactionalPage titleId="page-error-title" lang={props.lang}>
      <h1 id="page-error-title">{props.text.title}</h1>
      <p class="join-card-copy" role="alert">
        {props.text.body}
      </p>
      <div class="join-card-actions">
        <Button as="button" type="button" variant="primary" size="lg" icon="arrow-right" onClick={props.onRetry}>
          {props.text.reload}
        </Button>
        {/* A full page load: the router state after an error is not safe to reuse. */}
        <Button href="/" variant="secondary" size="lg" icon="open">
          {props.text.home}
        </Button>
      </div>
    </TransactionalPage>
  );
}
