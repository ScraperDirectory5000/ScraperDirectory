import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Unnamed Files — Public Records Search",
  description: "Search public records: addresses, phone numbers, court records, and more.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <a href="/" className="text-lg font-semibold text-brand-700">
              Unnamed Files
            </a>
            <nav className="flex gap-4 text-sm text-slate-600">
              <a href="/optout" className="hover:text-brand-700">
                Opt out / Remove my info
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-slate-400">
          Public record data is aggregated from government and public sources. Results may be
          incomplete or outdated. Not a consumer report under the FCRA — do not use for
          employment, credit, insurance, or tenant screening decisions.
        </footer>
      </body>
    </html>
  );
}
