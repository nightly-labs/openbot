// The neighbours of the dead-rule scan. Every class named here is reached a different way,
// and none of them may appear in the expected report. The rules in styles/legacy.css,
// styles/tokens.css and preview/preview.css are named here too: they exist for the colour
// and token budgets, and without a reference each would turn up as a dead rule and bury the
// two lines that scan is actually asserting.

function cx(...classes: string[]): string {
  return classes.join(" ");
}

export function Reachable(props: { index: number; state: string }) {
  return (
    <section
      id={`identifier-${props.index}`}
      class="reachable-from-markup legacy legacy-badge legacy-fade legacy-scrim tokenised preview"
    >
      <div
        class={[
          "reachable-from-markup",
          `reachable-family-${props.state}`,
        ]}
      />
      <div class={cx("reachable-from-markup", `reachable-from-cx-${props.state}`)} />
    </section>
  );
}
