"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gavel, LayoutGrid, Trophy, CalendarDays } from "lucide-react";

const ITEMS = [
  { href: "/works", label: "Работы", icon: LayoutGrid },
  { href: "/", label: "События", icon: CalendarDays },
  { href: "/leaderboard", label: "Лидеры", icon: Trophy },
  { href: "/judge", label: "Судейство", icon: Gavel },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 py-1">
        {ITEMS.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-1 px-2 py-2 text-[10px] transition-colors ${
                active ? "text-ink" : "text-muted-ink"
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2 : 1.5} />
              <span
                className={
                  active
                    ? "font-mono font-semibold tracking-[0.12em] uppercase border-b-2 border-gold pb-px"
                    : "font-mono tracking-[0.12em] uppercase"
                }
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
