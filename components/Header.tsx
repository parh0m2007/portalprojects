"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useGetIdentity, useLogout, useList, useUpdate, useInvalidate } from "@refinedev/core";
import { supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";

const NAV = [
  { href: "/works", label: "Работы" },
  { href: "/", label: "События" },
  { href: "/calendar", label: "Календарь" },
  { href: "/leaderboard", label: "Лидеры" },
];

type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  created_at: string;
};

export function Header() {
  const { data: identity, isLoading } = useGetIdentity<Identity | null>();
  const { mutate: logout } = useLogout();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { mutate: updateNotification } = useUpdate();
  const invalidate = useInvalidate();

  const notifCountQuery = useList<Notification>({
    resource: "notifications",
    filters: [
      { field: "user_id", operator: "eq", value: identity?.id ?? "" },
      { field: "read", operator: "eq", value: false },
    ],
    pagination: { pageSize: 1 },
    queryOptions: {
      enabled: !!identity?.id,
      refetchInterval: 30000,
    },
  });
  const unreadCount = notifCountQuery.result.total ?? 0;

  const notifListQuery = useList<Notification>({
    resource: "notifications",
    filters: [{ field: "user_id", operator: "eq", value: identity?.id ?? "" }],
    sorters: [{ field: "created_at", order: "desc" }],
    pagination: { pageSize: 12 },
    queryOptions: { enabled: !!identity?.id },
  });
  const notifications = notifListQuery.result.data ?? [];

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function openNotification(n: Notification) {
    if (!n.read) {
      updateNotification({
        resource: "notifications",
        id: n.id,
        values: { read: true },
      });
    }
    setBellOpen(false);
    if (n.link) router.push(n.link);
  }

  function markAllRead() {
    if (!identity) return;
    supabaseClient
      .from("notifications")
      .update({ read: true })
      .eq("user_id", identity.id)
      .eq("read", false)
      .then(() => {
        invalidate({ resource: "notifications", invalidates: ["list"] });
      });
  }

  const initials = identity?.full_name
    ? identity.full_name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur">
      <div className="container-page flex h-16 items-center gap-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 bg-gold" aria-hidden="true" />
          <span className="font-display text-sm font-bold uppercase tracking-tight text-ink">
            КейсПортал
          </span>
        </Link>

        <nav className="ml-1 hidden items-center gap-6 md:flex">
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`eyebrow border-b-2 pb-0.5 transition-colors ${
                  active
                    ? "border-gold text-ink"
                    : "border-transparent text-muted-ink hover:border-line hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {isLoading ? null : identity ? (
            <>
              {/* Уведомления */}
              <div className="relative" ref={bellRef}>
                <button
                  onClick={() => setBellOpen((v) => !v)}
                  className="relative flex h-10 w-10 items-center justify-center text-muted-ink transition-colors hover:text-ink"
                  aria-label="Уведомления"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute right-1 top-1.5 h-2 w-2 rounded-full bg-gold" />
                  )}
                </button>

                {bellOpen && (
                  <div className="absolute right-0 mt-2 w-80 border border-line bg-white shadow-[4px_4px_0_0_var(--color-line)] sm:w-96">
                    <div className="flex items-center justify-between border-b border-line px-4 py-3">
                      <span className="eyebrow">Уведомления</span>
                      {unreadCount > 0 && (
                        <button
                          onClick={markAllRead}
                          className="text-xs font-semibold text-navy hover:underline"
                        >
                          Отметить всё прочитанным
                        </button>
                      )}
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {notifListQuery.query.isLoading ? (
                        <p className="px-4 py-6 text-center text-sm text-muted">
                          Загрузка…
                        </p>
                      ) : notifications.length === 0 ? (
                        <p className="px-4 py-8 text-center text-sm text-muted">
                          Пока нет уведомлений
                        </p>
                      ) : (
                        notifications.map((n) => (
                          <button
                            key={n.id}
                            onClick={() => openNotification(n)}
                            className={`flex w-full gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-paper ${
                              !n.read ? "bg-gold-100/40" : ""
                            }`}
                          >
                            {!n.read && (
                              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold" />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">
                                {n.title}
                              </span>
                              {n.body && (
                                <span className="mt-0.5 block truncate text-xs text-muted">
                                  {n.body}
                                </span>
                              )}
                              <span className="meta mt-1 block">
                                {new Date(n.created_at).toLocaleString("ru-RU", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Профиль */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex items-center gap-2.5 px-1 py-1.5 transition-colors hover:opacity-80"
                >
                  <span className="flex h-9 w-9 items-center justify-center bg-ink font-mono text-[11px] font-semibold tracking-wider text-white">
                    {initials}
                  </span>
                  <span className="hidden text-sm font-semibold sm:block">
                    {identity.full_name || "Профиль"}
                  </span>
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                    <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-60 border border-line bg-white py-1.5 shadow-[4px_4px_0_0_var(--color-line)]">
                    {[
                      { href: "/my", label: "Мои мероприятия" },
                      { href: "/my/registrations", label: "Мои регистрации" },
                      { href: "/judge", label: "Судейство" },
                    ].map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMenuOpen(false)}
                        className="block px-4 py-2.5 text-sm font-medium transition-colors hover:bg-paper"
                      >
                        {item.label}
                      </Link>
                    ))}
                    <div className="my-1.5 border-t border-line" />
                    <button
                      onClick={() => logout()}
                      className="block w-full px-4 py-2.5 text-left text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50"
                    >
                      Выйти
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="btn btn-ghost !py-2"
              >
                Войти
              </Link>
              <Link
                href="/register"
                className="btn btn-accent hidden !py-2 sm:inline-flex"
              >
                Создать аккаунт
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
