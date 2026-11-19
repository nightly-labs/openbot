export function ActivityShine(props: { text: string }) {
  return (
    <span class="agent-activity-shine" aria-hidden="true">
      <span class="agent-activity-shine-text">{props.text}</span>
    </span>
  );
}
