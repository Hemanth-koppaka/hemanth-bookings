import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { BookingProvider } from "../lib/booking-store";
import { AdminProvider } from "../lib/admin-store";
import { getSalonConfig } from "../lib/salon.functions";
import { salonJsonLd } from "@/lib/seo";
import { trackStep } from "@/lib/salon.functions";
import { applyConfig } from "../lib/salon";
import { sfx } from "../lib/sfx";

function NotFoundComponent() {
  return (
    <div className="flex min-h-[100svh] items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">
        <div className="eyebrow">404</div>
        <h1 className="mt-4 font-display text-4xl leading-tight">
          This page is
          <br />
          not on the menu.
        </h1>
        <Link to="/" className="label-caps mt-8 inline-flex border-b border-foreground/30 pb-1">
          Return home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-[100svh] items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">
        <h1 className="font-display text-3xl">This page didn't load</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Something went wrong. Try again, or head back home.
        </p>
        <div className="mt-8 flex justify-center gap-6">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="label-caps border-b border-foreground/30 pb-1"
          >
            Try again
          </button>
          <a href="/" className="label-caps border-b border-foreground/30 pb-1">
            Home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: ({ loaderData }) => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "Lumen Studio — Book your moment" },
      { name: "author", content: "Hemanth Koppaka" },
      {
        name: "description",
        content:
          "Book cut, colour and care appointments with Kiran Rao at Sector 9, Midtown, Metro City.",
      },
      { name: "google-site-verification", content: "-E2n6oC7-8kwVVCbhPLKbJ3KZgGBIlxC1ig4witN4K0" },
      { property: "og:site_name", content: "Lumen Studio" },
      { property: "og:locale", content: "en_IN" },
      { name: "theme-color", content: "#F4FAF8" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,300&family=Manrope:wght@300;400;500&display=swap",
      },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico?v=3" },
      { rel: "icon", type: "image/png", sizes: "48x48", href: "/icons/favicon-48.png?v=3" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icons/favicon-192.png?v=3" },
      { rel: "icon", type: "image/png", sizes: "96x96", href: "/favicon.png?v=3" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/icons/apple-touch-icon.png?v=3" },
    ],
    // the salon for search engines (name, address, hours, services, prices)
    scripts: loaderData?.configJson
      ? [
          {
            type: "application/ld+json",
            children: salonJsonLd(loaderData.configJson, loaderData.origin ?? ""),
          },
        ]
      : [],
  }),
  loader: async () => {
    try {
      return await getSalonConfig();
    } catch {
      return { configJson: "{}", origin: "" };
    }
  },
  staleTime: 60_000,
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: (props) => <ErrorComponent error={props.error as Error} reset={props.reset} />,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Decide before first paint whether the home intro should play (once per session, home only). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var k='bk-intro',r=document.documentElement,m=matchMedia('(prefers-reduced-motion: reduce)').matches||localStorage.getItem('bk-reduced-motion')==='reduce';if(m)r.classList.add('reduced-motion');if(m||sessionStorage.getItem(k)||location.pathname!=='/')r.classList.add('intro-seen');sessionStorage.setItem(k,'1')}catch(e){document.documentElement.classList.add('intro-seen')}",
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// The booking journey in order: moving forward plays the cinematic step
// transition, moving back plays the soft "shhh—click".
const FLOW: Record<string, number> = {
  "/": 0,
  "/book": 1,
  "/services": 2,
  "/time": 3,
  "/details": 4,
  "/review": 5,
};

/** Installs interface sound once and gives every route change its sound. */
/** Counts which booking steps visitors reach (once per page view; no cookies). */
const TRACKED: Record<
  string,
  "home" | "book" | "services" | "time" | "details" | "review" | "booked"
> = {
  "/": "home",
  "/book": "book",
  "/services": "services",
  "/time": "time",
  "/details": "details",
  "/review": "review",
  "/confirmed": "booked",
};

function JourneyCounter() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    const step = TRACKED[path.replace(/\/$/, "") || "/"];
    if (!step || navigator.webdriver) return;
    const t = window.setTimeout(() => void trackStep({ data: { step } }).catch(() => {}), 800);
    return () => window.clearTimeout(t);
  }, [path]);
  return null;
}

function SoundDirector() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const prev = useRef<string | null>(null);
  useEffect(() => sfx.install(), []);
  useEffect(() => {
    const from = prev.current;
    prev.current = path;
    if (from === null || from === path || path.startsWith("/admin")) return;
    const a = FLOW[from];
    const b = FLOW[path];
    if (a !== undefined && b !== undefined) {
      if (b > a) sfx.transition();
      else sfx.back();
    } else if (path === "/") {
      sfx.back(); // leaving an info page for home
    } else if (b !== undefined) {
      sfx.transition(); // stepping into the booking flow from an info page
    }
  }, [path]);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { configJson } = Route.useLoaderData();
  applyConfig(JSON.parse(configJson));

  return (
    <QueryClientProvider client={queryClient}>
      <BookingProvider>
        <AdminProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <SoundDirector />
          <JourneyCounter />
        </AdminProvider>
      </BookingProvider>
    </QueryClientProvider>
  );
}
