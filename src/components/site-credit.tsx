import { ArrowUpRight, Instagram } from "lucide-react";
import { cn } from "@/lib/utils";

/** Who built the site: a quiet credit, linking to their Instagram. */
export const SITE_CREDIT = {
  name: "Hemanth Koppaka",
  initials: "HK",
  instagram: "_hemanthkoppaka_739_unique",
  url: "https://www.instagram.com/_hemanthkoppaka_739_unique/",
};

/**
 * A small outlined tag, always one line: HK mark · "Designed & built by" ·
 * name · Instagram ↗ (the handle is spelled out where there's room).
 * `closed` puts a hairline above it so the page ends on a line, in the page's
 * own colour (no fill).
 */
export function SiteCredit({
  className,
  closed,
  tone = "light",
}: {
  className?: string;
  closed?: boolean;
  /** "dark": on the dark confirmation screen */
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden whitespace-nowrap px-4 max-[359px]:px-0 text-[clamp(0.6rem,2.7vw,0.68rem)] tracking-[0.04em]",
        dark ? "text-[#E8E1D8]/55" : "text-muted-foreground/75",
        closed && "border-t border-hairline py-2.5",
        className,
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1",
          dark ? "border-[#E8E1D8]/15" : "border-foreground/12",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "mr-0.5 flex h-[1.9em] w-[1.9em] shrink-0 items-center justify-center rounded-full border font-display text-[1.05em] tracking-normal",
            dark
              ? "border-[#E8E1D8]/25 text-[#E8E1D8]/80"
              : "border-foreground/20 text-foreground/70",
          )}
        >
          {SITE_CREDIT.initials}
        </span>
        <span>Designed &amp; built by</span>
        <a
          href={SITE_CREDIT.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "underline decoration-[0.5px] underline-offset-[3px] transition-colors",
            dark
              ? "text-[#E8E1D8]/85 decoration-[#E8E1D8]/35 hover:text-[#E8E1D8]"
              : "text-foreground/70 decoration-foreground/30 hover:text-foreground hover:decoration-foreground/70",
          )}
        >
          {SITE_CREDIT.name}
        </a>
        <span aria-hidden className={dark ? "text-[#E8E1D8]/25" : "text-foreground/25"}>
          ·
        </span>
        <a
          href={SITE_CREDIT.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${SITE_CREDIT.name} on Instagram (@${SITE_CREDIT.instagram})`}
          className={cn(
            "inline-flex items-center gap-1 underline-offset-4 transition-colors hover:underline",
            dark
              ? "text-[#E8E1D8]/65 hover:text-[#E8E1D8]"
              : "text-foreground/55 hover:text-foreground",
          )}
        >
          <Instagram className="h-[1.1em] w-[1.1em] shrink-0" strokeWidth={1.5} aria-hidden />
          <span className="max-[479px]:hidden">@{SITE_CREDIT.instagram}</span>
          <ArrowUpRight
            className="-ml-0.5 h-[1em] w-[1em] shrink-0"
            strokeWidth={1.5}
            aria-hidden
          />
        </a>
      </p>
    </div>
  );
}
