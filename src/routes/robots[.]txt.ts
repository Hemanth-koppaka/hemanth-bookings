import { createFileRoute } from "@tanstack/react-router";

// Search engines may read the public site; the site's internal endpoints stay
// out of search results. The admin console is deliberately NOT listed here
// (this file is public and would reveal its address); its pages carry a
// "noindex" tag instead. The sitemap pointer always uses the public domain,
// never the preview address the request happened to arrive on.
const PUBLIC_ORIGIN = "https://salon.example.com";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const body = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /_serverFn/
Disallow: /confirmed
Disallow: /stylist

Sitemap: ${PUBLIC_ORIGIN}/sitemap.xml
`;
        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
