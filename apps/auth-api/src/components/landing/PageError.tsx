import { Button } from "../ui/button";

export function PageError(props: { onRetry: () => void }) {
  return (
    <main class="join-page">
      <section class="join-card" aria-labelledby="page-error-title">
        <h1 id="page-error-title">This page could not load</h1>
        <p class="join-card-copy" role="alert">
          Check your connection and reload the page. If it still does not load, go back to the home page.
        </p>
        <div class="join-card-actions">
          <button class="landing-button landing-button-primary landing-button-lg" type="button" onClick={props.onRetry}>
            Reload page
          </button>
          <Button href="/" variant="secondary" size="lg" icon="open">
            Back to home
          </Button>
        </div>
      </section>
    </main>
  );
}
