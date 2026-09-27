// Pages that moved to a new address. A 301 moves search results and saved links
// to the new page; the old address had been shared before the move.

export function movedPermanently(location: string): Response {
  return new Response(null, {
    status: 301,
    headers: {
      "cache-control": "public, max-age=86400",
      location,
    },
  });
}
