import type { Metadata } from "next";
import { Suspense } from "react";
import { Golos_Text, IBM_Plex_Mono, Unbounded } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";

const golos = Golos_Text({
  variable: "--font-golos",
  subsets: ["latin", "cyrillic"],
});

const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin", "cyrillic"],
  weight: ["500", "700", "900"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "КейсПортал — мероприятия, кейсы и рейтинги команд",
  description:
    "Витрина событий, регистрация команд на кейс-чемпионаты и лекции, загрузка решений, оценка судьями и таблица лидеров.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${golos.variable} ${unbounded.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>
          <Suspense fallback={<div className="h-16 border-b border-line" />}>
            <Header />
          </Suspense>
          <main className="flex-1">
            <Suspense>{children}</Suspense>
          </main>
          <div className="h-16 md:hidden" />
          <footer className="mt-20 border-t border-line py-8">
            <div className="container-page flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              <span>© 2026 КейсПортал</span>
              <span>Мероприятия · Кейсы · Решения · Судейство</span>
            </div>
          </footer>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
