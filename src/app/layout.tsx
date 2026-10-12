import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppProvider } from "@/lib/app-context";
import { ServiceWorker } from "@/components/app/service-worker";

export const metadata: Metadata = {
  title: { default: "YES Canvassing", template: "%s · YES" },
  description: "Youth Education Scholarship — field app for student canvassers, leaders and admins.",
  applicationName: "YES Canvassing",
  appleWebApp: { capable: true, title: "YES", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f4f8" },
    { media: "(prefers-color-scheme: dark)", color: "#071528" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>
        {/* Launch splash: once per session, pure CSS so it never waits on JS */}
        <script dangerouslySetInnerHTML={{ __html: "try{sessionStorage.getItem('yes-splash')?document.documentElement.classList.add('splash-seen'):sessionStorage.setItem('yes-splash','1')}catch(e){}" }} />
        <div className="splash hero" aria-hidden>
          <div className="flex flex-col items-center">
            <svg width="88" height="88" viewBox="0 0 64 64" className="splash-logo">
              <rect width="64" height="64" rx="15" fill="#0B1F3A" />
              <path className="splash-arc" pathLength={1} d="M14 46c6-4 12-4 18 0 6-4 12-4 18 0" stroke="#5B8DEF" strokeWidth="3" fill="none" strokeLinecap="round" />
              <text className="splash-word" x="32" y="36" textAnchor="middle" fontFamily="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"
                fontWeight="800" fontSize="21" letterSpacing="-0.5" fill="#FFFFFF">YES</text>
            </svg>
            <p className="splash-tag mt-5 text-[13px] font-medium tracking-[0.08em] text-white/70">YOUTH EDUCATION SCHOLARSHIP</p>
          </div>
        </div>
        <AppProvider>{children}</AppProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
