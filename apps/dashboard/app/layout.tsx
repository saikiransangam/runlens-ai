import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "RunLens",
  description: "Statistical reliability reports for AI agents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="M7.5 11h2l1.5-3 2 6 1.5-3h2" />
                <path d="M16.5 16.5 21 21" />
              </svg>
              RunLens
            </Link>
            <a className="crumbs" href="https://github.com/saikiransangam/runlens-ai">GitHub</a>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
