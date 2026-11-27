import { createFileRoute } from "@tanstack/react-router";

// The public pages for search engines, always on the public domain — never
// the preview address the request happened to arrive on. The booking steps
// need a choice first, so only their entry is listed.
const PUBLIC_ORIGIN = "https://salon.example.com";

const PAGES = [
  { path: "/", priority: "1.0", freq: "weekly" },
  { path: "/book", priority: "0.9", freq: "weekly" },
  { path: "/hours", priority: "0.8", freq: "weekly" },
  { path: "/contact", priority: "0.8", freq: "monthly" },
  { path: "/artist", priority: "0.7", freq: "monthly" },
  { path: "/studio", priority: "0.7", freq: "monthly" },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map((p) => `  <url><loc>${PUBLIC_ORIGIN}${p.path}</loc><changefreq>${p.freq}</changefreq><priority>${p.priority}</priority></url>`).join("\n")}
</urlset>
`;
        return new Response(body, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
