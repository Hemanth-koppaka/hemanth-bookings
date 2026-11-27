import { createFileRoute } from "@tanstack/react-router";
import { CinematicKit } from "@/components/cinematic-kit";

// Preview of the barber-kit film (not linked from the site yet).
export const Route = createFileRoute("/film")({
  head: () => ({
    meta: [
      { name: "description", content: "View the Hair by Kiran appointment film." },
      { property: "og:title", content: "The kit \u2014 Hair by Kiran" },
      { property: "og:description", content: "View the Hair by Kiran appointment film." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },{ title: "The kit — Hair by Kiran" }, { name: "robots", content: "noindex" }],
  }),
  component: Film,
});

function Film() {
  return (
    <div className="flex min-h-[100svh] items-center justify-center bg-[#0b0806] p-4">
      <CinematicKit className="w-[min(100%,52svh)] rounded-sm" loop />
    </div>
  );
}
