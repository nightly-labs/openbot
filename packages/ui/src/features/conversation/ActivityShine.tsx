/**
 * The light that runs over the label of a working agent. Put it last inside the `.agent-activity-label`
 * element, with the same text.
 *
 * It is a copy of the text in the colour of the light, seen through a soft window. The window and the
 * copy move in opposite directions by the same amount, so the copy stays on the label while the window
 * crosses it. Both are transforms, which the compositor runs. The light used to be an animated
 * `background-position` on the text, which restyled and repainted the label on the main thread on each
 * frame for as long as the agent worked (#6256).
 */
export function ActivityShine(props: { text: string }) {
  return (
    <span class="agent-activity-shine" aria-hidden="true">
      <span class="agent-activity-shine-text">{props.text}</span>
    </span>
  );
}
