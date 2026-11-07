// OPENBOT PATCH: link-preview-js is an optional peer that OpenBot does not install (no link previews are
// fetched). Upstream types it through a devDependency.
declare module 'link-preview-js' {
	export function getLinkPreview(text: string, options?: unknown): Promise<any>
}
