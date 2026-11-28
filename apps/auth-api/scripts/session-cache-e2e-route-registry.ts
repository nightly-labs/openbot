export type RouteHandler = (input: { request: Request }) => Promise<Response>;

const handlers = new Map<string, RouteHandler>();

export function registerRouteHandler(path: string, method: string, handler: RouteHandler) {
  handlers.set(`${method} ${path}`, handler);
}

export function routeHandler(path: string, method: string): RouteHandler | undefined {
  return handlers.get(`${method} ${path}`);
}
