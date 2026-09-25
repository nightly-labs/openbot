/**
 * The site path of one agent template. It is apart from `agent-templates.ts`, which holds a server
 * function, so the page component can load where no Worker runs, such as Storybook.
 */
export function agentTemplatePath(id: string): string {
  return `/agents/${id}`;
}
