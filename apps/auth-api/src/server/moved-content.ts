export function movedPermanently(location: string): Response {
  return new Response(null, {
    status: 301,
    headers: {
      "cache-control": "public, max-age=86400",
      location,
    },
  });
}
