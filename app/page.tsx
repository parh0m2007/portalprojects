"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Heart, Search } from "lucide-react";
import { useList, useGetIdentity, useNotification } from "@refinedev/core";
import { supabaseClient, publicFileUrl, COVERS_BUCKET } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import { EventCard, type EventRecord } from "@/components/EventCard";
import { TagChips, type Tag } from "@/components/TagChips";
import {
  CoverPlaceholder,
  EmptyState,
  Skeleton,
  StatCard,
  formatDate,
  formatShortDate,
  isRegistrationClosed,
} from "@/components/ui";

type EventStats = {
  event_id: string;
  participants_count: number;
  solutions_count: number;
};

type EventTag = { event_id: string; tag_id: string };
type InterestRow = { profile_id: string; tag_id: string };
type ViewRow = { event_id: string; viewed_at: string };
type HideRow = { event_id: string; hidden_at: string };
type SearchQueryRow = {
  id: string;
  query: string;
  embedding?: string | null;
  searched_at: string;
};

type FeedRow = EventRecord & { score: number; match_count: number };

// τ затухания сигналов (дни): недельной давности ~0.72, трёхнедельной ~0.37
const TAU_DAYS = 21;

function decayAge(at?: string | null): number {
  if (!at) return 1;
  const days = (Date.now() - new Date(at).getTime()) / 86400000;
  return Math.exp(-Math.max(days, 0) / TAU_DAYS);
}

function parseVec(value: unknown): number[] | null {
  if (typeof value !== "string") return null;
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) && arr.every((v) => typeof v === "number")
      ? arr
      : null;
  } catch {
    return null;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// Порог семантического поиска: ниже — шум, выше — теряем смежные темы (BGE-M3)
const SEMANTIC_SEARCH_THRESHOLD = 0.35;

// Анти-пузырь: ~8% слотов ленты — события вне текущего вкуса («разведка»),
// а рядом не стоят два события с косинусом > 0.9, иначе после серии
// сохранений лента вырождается в один кластер.
const EXPLORER_SHARE = 0.08;
const MAX_NEIGHBOR_SIM = 0.9;

function diversifyFeed(
  ranked: FeedRow[],
  embeddings: Map<string, number[]>,
  tasteVec: number[] | null,
): { items: FeedRow[]; exploreIds: Set<string> } {
  if (ranked.length < 4) return { items: ranked, exploreIds: new Set() };

  // 1) слоты разведки — наименее близкие ко вкусу события
  const byTasteSim =
    tasteVec === null
      ? null
      : new Map(
          ranked.map((e) => {
            const v = embeddings.get(e.id);
            return [e.id, v ? cosine(v, tasteVec) : 1] as const;
          }),
        );
  const explorerCount =
    byTasteSim === null
      ? 0
      : Math.max(1, Math.round(ranked.length * EXPLORER_SHARE));
  const exploreIds = new Set<string>();
  if (byTasteSim !== null) {
    [...ranked]
      .sort((a, b) => (byTasteSim.get(a.id) ?? 1) - (byTasteSim.get(b.id) ?? 1))
      .slice(0, explorerCount)
      .forEach((e) => exploreIds.add(e.id));
  }

  // 2) жадная раскладка основного пула без почти-дубликатов рядом
  const placed: FeedRow[] = [];
  const deferred: FeedRow[] = [];
  let lastVec: number[] | null = null;
  for (const e of ranked) {
    if (exploreIds.has(e.id)) continue;
    const v = embeddings.get(e.id) ?? null;
    if (lastVec && v && cosine(v, lastVec) > MAX_NEIGHBOR_SIM) {
      deferred.push(e);
    } else {
      placed.push(e);
      lastVec = v;
    }
  }

  // отложенные вставляем в первую свободную от конфликта позицию (с конца,
  // чтобы минимально двигать верх ленты); проверяем обоих соседей
  for (const e of deferred) {
    const v = embeddings.get(e.id);
    let idx = -1;
    if (v) {
      for (let i = placed.length; i >= 0 && idx < 0; i--) {
        const prev =
          i > 0 ? embeddings.get(placed[i - 1].id) ?? null : null;
        const next =
          i < placed.length ? embeddings.get(placed[i].id) ?? null : null;
        const clash =
          (prev && cosine(v, prev) > MAX_NEIGHBOR_SIM) ||
          (next && cosine(v, next) > MAX_NEIGHBOR_SIM);
        if (!clash) idx = i;
      }
    }
    if (idx >= 0) placed.splice(idx, 0, e);
    else placed.push(e);
  }

  // 3) разведка распределяется равномерно, но тоже не встаёт рядом
  // с почти-дубликатом — при конфликте сдвигается ближе к концу ленты
  if (exploreIds.size === 0) return { items: placed, exploreIds };
  const explorers = ranked.filter((e) => exploreIds.has(e.id));
  const total = placed.length + explorers.length;
  const items: FeedRow[] = [];
  let pi = 0;
  let nextExplorer = 0;
  while (nextExplorer < explorers.length && pi < placed.length) {
    const target = Math.floor(
      ((nextExplorer + 1) * total) / (explorers.length + 1),
    );
    if (items.length < target) {
      items.push(placed[pi++]);
      continue;
    }
    const ex = explorers[nextExplorer];
    const v = embeddings.get(ex.id);
    const prev =
      items.length > 0
        ? embeddings.get(items[items.length - 1].id) ?? null
        : null;
    const next = embeddings.get(placed[pi].id) ?? null;
    const clash =
      v &&
      ((prev && cosine(v, prev) > MAX_NEIGHBOR_SIM) ||
        (next && cosine(v, next) > MAX_NEIGHBOR_SIM));
    if (clash) {
      items.push(placed[pi++]);
    } else {
      items.push(ex);
      nextExplorer += 1;
    }
  }
  while (pi < placed.length) items.push(placed[pi++]);
  while (nextExplorer < explorers.length) items.push(explorers[nextExplorer++]);
  return { items, exploreIds };
}

export default function HomePage() {
  const { data: identity } = useGetIdentity<Identity | null>();
  const { open } = useNotification();
  const [hiddenLocal, setHiddenLocal] = useState<Set<string>>(new Set());
  const [favLocal, setFavLocal] = useState<Set<string>>(new Set());
  const [feed, setFeed] = useState<FeedRow[] | null>(null);
  const [feedVersion, setFeedVersion] = useState(0);
  const [profileVec, setProfileVec] = useState<string | null>(null);
  const [tasteVec, setTasteVec] = useState<number[] | null>(null);
  const [embeddings, setEmbeddings] = useState<Map<string, number[]>>(
    new Map(),
  );
  const [semanticQuery, setSemanticQuery] = useState<{
    text: string;
    emb: number[];
  } | null>(null);

  const bumpFeed = () => setFeedVersion((v) => v + 1);

  const eventsQuery = useList<EventRecord>({
    resource: "events",
    filters: [{ field: "status", operator: "eq", value: "published" }],
    sorters: [{ field: "starts_at", order: "asc" }],
    pagination: { pageSize: 60 },
    // Без embedding: колонка ~20КБ/строка и на главной не нужна
    meta: {
      select:
        "id,title,description,format,place,starts_at,registration_deadline,status,author_id,cover_path,results_published_at,capacity",
    },
  });
  const statsQuery = useList<EventStats>({
    resource: "event_stats",
    pagination: { pageSize: 200 },
  });
  const tagsQuery = useList<Tag>({
    resource: "tags",
    sorters: [{ field: "sort_order", order: "asc" }],
    pagination: { pageSize: 100 },
  });
  const eventTagsQuery = useList<EventTag>({
    resource: "event_tags",
    pagination: { pageSize: 500 },
  });
  const interestsQuery = useList<InterestRow>({
    resource: "profile_interests",
    filters: [
      { field: "profile_id", operator: "eq", value: identity?.id ?? "" },
    ],
    pagination: { pageSize: 100 },
    queryOptions: { enabled: !!identity?.id },
  });
  const favoritesQuery = useList<{ user_id: string; event_id: string; created_at: string }>({
    resource: "event_favorites",
    filters: [{ field: "user_id", operator: "eq", value: identity?.id ?? "" }],
    sorters: [{ field: "created_at", order: "desc" }],
    pagination: { pageSize: 100 },
    queryOptions: { enabled: !!identity?.id },
  });
  const myRegsQuery = useList<{ event_id: string; created_at: string }>({
    resource: "registrations",
    filters: [{ field: "user_id", operator: "eq", value: identity?.id ?? "" }],
    pagination: { pageSize: 100 },
    queryOptions: { enabled: !!identity?.id },
  });
  const viewsQuery = useList<ViewRow>({
    resource: "event_views",
    filters: [{ field: "user_id", operator: "eq", value: identity?.id ?? "" }],
    sorters: [{ field: "viewed_at", order: "desc" }],
    pagination: { pageSize: 200 },
    queryOptions: { enabled: !!identity?.id },
  });
  const hidesQuery = useList<HideRow>({
    resource: "event_hides",
    filters: [{ field: "user_id", operator: "eq", value: identity?.id ?? "" }],
    sorters: [{ field: "hidden_at", order: "desc" }],
    pagination: { pageSize: 100 },
    queryOptions: { enabled: !!identity?.id },
  });
  const searchLogQuery = useList<SearchQueryRow>({
    resource: "search_queries",
    filters: [{ field: "user_id", operator: "eq", value: identity?.id ?? "" }],
    sorters: [{ field: "searched_at", order: "desc" }],
    pagination: { pageSize: 30 },
    queryOptions: { enabled: !!identity?.id },
  });

  // Вектор вкуса: взвешенное среднее эмбеддингов с затуханием по времени.
  // Регистрации ×5, избранное ×3, просмотры ×1, скрытия ×(−2), поиск ×4.
  const signals = useMemo(() => {
    if (!identity) return [];
    const list: { id: string; weight: number; at: string | null }[] = [];
    for (const r of myRegsQuery.result.data ?? []) {
      list.push({ id: r.event_id, weight: 5, at: r.created_at });
    }
    for (const f of favoritesQuery.result.data ?? []) {
      list.push({ id: f.event_id, weight: 3, at: f.created_at });
    }
    for (const v of viewsQuery.result.data ?? []) {
      list.push({ id: v.event_id, weight: 1, at: v.viewed_at });
    }
    for (const h of hidesQuery.result.data ?? []) {
      list.push({ id: h.event_id, weight: -2, at: h.hidden_at });
    }
    return list;
  }, [identity, favoritesQuery.result.data, myRegsQuery.result.data, viewsQuery.result.data, hidesQuery.result.data]);

  const signalIds = useMemo(
    () => [...new Set(signals.map((s) => s.id))],
    [signals],
  );

  useEffect(() => {
    const searchRows = identity ? searchLogQuery.result.data ?? [] : [];
    let cancelled = false;

    (async () => {
      // сброс вектора вне сигналов — асинхронно, чтобы не дёргать рендер из эффекта
      if (signalIds.length === 0 && searchRows.length === 0) {
        await Promise.resolve();
        if (!cancelled) {
          setProfileVec(null);
          setTasteVec(null);
        }
        return;
      }
      const weighted: { emb: number[]; w: number }[] = [];

      if (signalIds.length > 0) {
        const { data } = await supabaseClient
          .from("events")
          .select("id,embedding")
          .in("id", signalIds);
        if (cancelled) return;
        const embById = new Map(
          (data ?? []).map((r: { id: string; embedding: unknown }) => [
            r.id,
            parseVec(r.embedding),
          ]),
        );
        for (const s of signals) {
          const emb = embById.get(s.id);
          if (emb) weighted.push({ emb, w: s.weight * decayAge(s.at) });
        }
      }

      for (const sq of searchRows) {
        const emb = parseVec(sq.embedding);
        if (emb) weighted.push({ emb, w: 4 * decayAge(sq.searched_at) });
      }

      let acc: number[] | null = null;
      let absTotal = 0;
      for (const { emb, w } of weighted) {
        if (!acc) acc = new Array<number>(emb.length).fill(0);
        emb.forEach((v, i) => {
          acc![i] += v * w;
        });
        absTotal += Math.abs(w);
      }

      if (cancelled) return;
      if (!acc || absTotal === 0) {
        setProfileVec(null);
        setTasteVec(null);
        return;
      }
      const norm = Math.sqrt(acc.reduce((sum, v) => sum + v * v, 0)) || 1;
      const arr = acc.map((v) => v / absTotal / norm);
      // тот же вектор в двух видах: строка — для get_feed, массив — для
      // клиентского косинуса (семантический поиск + анти-пузырь)
      setTasteVec(arr);
      setProfileVec("[" + arr.map((v) => v.toFixed(6)).join(",") + "]");
    })().catch(() => {
      if (!cancelled) {
        setProfileVec(null);
        setTasteVec(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [identity, signals, signalIds, searchLogQuery.result.data]);

  useEffect(() => {
    let cancelled = false;
    const request = profileVec
      ? supabaseClient.rpc("get_feed", { profile_embedding: profileVec })
      : supabaseClient.rpc("get_feed");
    Promise.resolve(request)
      .then(({ data }) => {
        if (!cancelled) setFeed((data as FeedRow[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setFeed([]);
      });
    return () => {
      cancelled = true;
    };
  }, [identity?.id, feedVersion, profileVec]);

  // Эмбеддинги событий ленты: нужны на клиенте для семантического поиска
  // и анти-пузыря (косинус между соседями и со вкусом)
  useEffect(() => {
    const ids = (feed ?? []).map((e) => e.id);
    let cancelled = false;
    (async () => {
      if (ids.length === 0) {
        setEmbeddings(new Map());
        return;
      }
      const { data } = await supabaseClient
        .from("events")
        .select("id,embedding")
        .in("id", ids);
      if (cancelled) return;
      const map = new Map<string, number[]>();
      for (const r of data ?? []) {
        const v = parseVec(r.embedding);
        if (v) map.set(r.id, v);
      }
      setEmbeddings(map);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [feed]);

  const tags = tagsQuery.result.data ?? [];
  const events = eventsQuery.result.data ?? [];
  const statsMap = new Map(
    (statsQuery.result.data ?? []).map((s) => [s.event_id, s]),
  );

  const tagsByEvent = useMemo(() => {
    const tagsById = new Map(tags.map((t) => [t.id, t]));
    const map = new Map<string, Tag[]>();
    for (const et of eventTagsQuery.result.data ?? []) {
      const tag = tagsById.get(et.tag_id);
      if (!tag) continue;
      const list = map.get(et.event_id) ?? [];
      list.push(tag);
      map.set(et.event_id, list);
    }
    return map;
  }, [eventTagsQuery.result.data, tags]);

  const interestIds = useMemo(
    () => new Set((interestsQuery.result.data ?? []).map((r) => r.tag_id)),
    [interestsQuery.result.data],
  );

  function toggleInterest(tagId: string) {
    if (!identity) return;
    const had = interestIds.has(tagId);
    const request = had
      ? supabaseClient
          .from("profile_interests")
          .delete()
          .eq("profile_id", identity.id)
          .eq("tag_id", tagId)
      : supabaseClient
          .from("profile_interests")
          .insert({ profile_id: identity.id, tag_id: tagId });
    request.then(() => {
      interestsQuery.query.refetch().catch(() => {});
      bumpFeed();
    });
  }

  function isFavorite(eventId: string) {
    return (
      favLocal.has(eventId) ||
      (favoritesQuery.result.data ?? []).some((f) => f.event_id === eventId)
    );
  }

  function toggleFavorite(eventId: string) {
    if (!identity) return;
    const had = isFavorite(eventId);
    if (had) {
      setFavLocal((prev) => {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      });
      supabaseClient
        .from("event_favorites")
        .delete()
        .eq("user_id", identity.id)
        .eq("event_id", eventId)
        .then(() => {
          favoritesQuery.query.refetch().catch(() => {});
          bumpFeed();
        });
    } else {
      setFavLocal((prev) => new Set(prev).add(eventId));
      supabaseClient
        .from("event_favorites")
        .insert({ user_id: identity.id, event_id: eventId })
        .then(() => {
          favoritesQuery.query.refetch().catch(() => {});
          bumpFeed();
        }, () => {});
      open?.({
        type: "success",
        message: "Сохранено",
        description: "Лента подстроится под это событие и похожие темы.",
      });
    }
  }

  function hideEvent(eventId: string) {
    setHiddenLocal((prev) => new Set(prev).add(eventId));
    if (identity) {
      supabaseClient
        .from("event_hides")
        .insert({ user_id: identity.id, event_id: eventId })
        .then(() => {
          hidesQuery.query.refetch().catch(() => {});
          bumpFeed();
        }, () => {});
    }
  }

  // Поиск: фильтрует витрину и логируется как сильный сигнал вкуса
  const [searchText, setSearchText] = useState("");

  async function handleSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = searchText.trim();
    if (!identity || q.length < 3) return;
    try {
      const res = await fetch("/api/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: q }),
      });
      if (!res.ok) return;
      const json = (await res.json()) as { embedding?: number[] };
      if (!Array.isArray(json.embedding) || json.embedding.length === 0) return;
      setSemanticQuery({ text: q, emb: json.embedding });
      await supabaseClient.from("search_queries").insert({
        user_id: identity.id,
        query: q,
        embedding: "[" + json.embedding.join(",") + "]",
      });
      searchLogQuery.query.refetch().catch(() => {});
      bumpFeed();
    } catch {
      // поиск не должен ломать страницу при недоступном Ollama
    }
  }

  // Лента с сервера: уже отсортирована по score и очищена от скрытых
  const visible = useMemo(
    () => (feed ?? []).filter((e) => !hiddenLocal.has(e.id)),
    [feed, hiddenLocal],
  );

  // Анти-пузырь применяется к порядку ленты
  const diversified = useMemo(
    () => diversifyFeed(visible, embeddings, tasteVec),
    [visible, embeddings, tasteVec],
  );

  const q = searchText.trim().toLowerCase();
  // Гибридный поиск: точное вхождение текста ИЛИ семантическая близость
  // эмбеддинга запроса (найдёт «умный дом» без слова «дом» в заголовке).
  // Эмбеддинг действует только для того текста, который был отправлен.
  const shown = useMemo(() => {
    if (!q) return diversified.items;
    const semEmb =
      semanticQuery && semanticQuery.text.toLowerCase() === q
        ? semanticQuery.emb
        : null;
    return diversified.items
      .map((e) => {
        const v = semEmb ? embeddings.get(e.id) : undefined;
        return {
          e,
          textMatch: [
            e.title,
            e.description,
            e.place,
            ...(tagsByEvent.get(e.id) ?? []).map((t) => t.name),
          ]
            .join(" ")
            .toLowerCase()
            .includes(q),
          semSim: semEmb && v ? cosine(semEmb, v) : -1,
        };
      })
      .filter((s) => s.textMatch || s.semSim >= SEMANTIC_SEARCH_THRESHOLD)
      .sort(
        (a, b) =>
          Number(b.textMatch) - Number(a.textMatch) || b.semSim - a.semSim,
      )
      .map((s) => s.e);
  }, [diversified, q, semanticQuery, embeddings, tagsByEvent]);

  const favoriteEvents = useMemo(() => {
    const byId = new Map(events.map((e) => [e.id, e]));
    return (favoritesQuery.result.data ?? [])
      .map((f) => byId.get(f.event_id))
      .filter((e): e is EventRecord => !!e);
  }, [favoritesQuery.result.data, events]);

  const caseEvents = events.filter((e) => e.format === "case").length;
  const lectures = events.filter((e) => e.format === "lecture").length;
  const totalParticipants = events.reduce(
    (acc, e) => acc + (statsMap.get(e.id)?.participants_count ?? 0),
    0,
  );
  const nextEvent = visible.find(
    (e) => e.starts_at && new Date(e.starts_at) > new Date() && !isRegistrationClosed(e),
  );

  const loading = feed === null || eventsQuery.query.isLoading;

  return (
    <>
      {/* Hero */}
      <section className="border-b border-line bg-grid">
        <div className="container-page grid gap-10 py-14 md:grid-cols-[1.5fr_1fr] md:py-20 lg:py-24">
          <div>
            <p className="eyebrow">
              Витрина событий <span className="text-navy">· приём заявок открыт</span>
            </p>
            <h1 className="mt-6 max-w-3xl font-display text-[clamp(1.9rem,4.5vw,3.5rem)] font-bold uppercase leading-[1.04] tracking-tight">
              Покажи, что ты придумал и собрал
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-ink">
              Сохраняйте события и регистрируйтесь — лента сама подстроится под
              ваши интересы.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/leaderboard" className="btn btn-accent">
                Таблица лидеров
              </Link>
              <Link href="/my/events/new" className="btn btn-ghost">
                Создать мероприятие
              </Link>
            </div>
          </div>

          <aside className="self-end border border-line bg-white p-6">
            <p className="eyebrow">Ближайшее событие</p>
            {nextEvent ? (
              <>
                <p className="mt-4 font-display text-lg font-bold leading-snug">
                  {nextEvent.title}
                </p>
                <p className="meta mt-2">{formatDate(nextEvent.starts_at)}</p>
                <Link
                  href={`/events/${nextEvent.id}`}
                  className="btn btn-primary mt-6 w-full"
                >
                  Подробнее и регистрация
                </Link>
              </>
            ) : (
              <p className="muted mt-3">
                Скоро здесь появится новое мероприятие.
              </p>
            )}
          </aside>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b border-line bg-white">
        <div className="container-page grid grid-cols-2 gap-x-6 gap-y-8 py-10 md:grid-cols-4">
          <StatCard value={events.length} label="событий в ленте" />
          <StatCard value={caseEvents} label="кейс-чемпионатов" />
          <StatCard value={lectures} label="лекций" />
          <StatCard value={totalParticipants} label="заявок подано" tone="navy" />
        </div>
      </section>

      <div className="container-page py-12">
        {/* Сохранённые */}
        {identity && favoriteEvents.length > 0 && (
          <section className="mb-10 border border-line bg-white p-5 md:p-6">
            <p className="eyebrow">
              Сохранённые <span className="text-muted-ink">/ по ним лента поднимает похожие события</span>
            </p>
            <div className="scrollbar-none -mx-1 mt-4 flex gap-3 overflow-x-auto px-1 pb-1">
              {favoriteEvents.map((e) => (
                <div
                  key={e.id}
                  className="group relative w-60 shrink-0 border border-line bg-paper"
                >
                  <Link href={`/events/${e.id}`} className="block">
                    {publicFileUrl(COVERS_BUCKET, e.cover_path) ? (
                      <img
                        src={publicFileUrl(COVERS_BUCKET, e.cover_path)!}
                        alt={e.title}
                        loading="lazy"
                        className="h-24 w-full object-cover"
                      />
                    ) : (
                      <CoverPlaceholder seed={e.id} className="h-24" />
                    )}
                    <div className="p-3">
                      <p className="truncate text-sm font-bold">{e.title}</p>
                      <p className="meta mt-1">{formatShortDate(e.starts_at)}</p>
                    </div>
                  </Link>
                  <button
                    onClick={() => toggleFavorite(e.id)}
                    title="Убрать из сохранённых"
                    aria-label="Убрать из сохранённых"
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center border border-line bg-white/95 text-muted-ink transition-colors hover:text-ink"
                  >
                    <Heart
                      size={14}
                      strokeWidth={1.8}
                      fill="var(--color-gold)"
                      stroke="#c47f00"
                    />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Интересы (холодный старт) */}
        {identity && (
          <section className="mb-10 border border-line bg-white p-5 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="eyebrow">Персональная лента</p>
                <p className="muted mt-1">
                  {interestIds.size > 0
                    ? `Отмечено интересов: ${interestIds.size} — плюс сохранения, регистрации и просмотры влияют на порядок`
                    : "Отметьте интересы — а дальше лента обучается на ваших сохранениях и регистрациях"}
                </p>
              </div>
              {interestIds.size > 0 && (
                <span className="badge badge-green">Лента настроена</span>
              )}
            </div>
            <div className="mt-4">
              <TagChips
                tags={tags}
                selected={interestIds}
                onToggle={toggleInterest}
              />
            </div>
          </section>
        )}

        {/* Лента */}
        <section className="py-2">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-5">
            <div>
              <h2 className="h1 uppercase">Витрина событий</h2>
              <p className="muted mt-2">
                Кейс-чемпионаты и лекции — по порядку персональных рекомендаций.
              </p>
            </div>
            {identity && (
              <form onSubmit={handleSearchSubmit} className="flex w-full max-w-md gap-2">
                <input
                  className="input flex-1"
                  placeholder="Поиск: роботы, нейросети, эко…"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                />
                <button type="submit" className="btn btn-primary shrink-0">
                  <Search size={13} strokeWidth={2} />
                  Найти
                </button>
              </form>
            )}
          </div>
          {identity && (
            <p className="muted mb-5 max-w-2xl text-xs">
              Поиск смысловой: сравнивает эмбеддинг запроса с эмбеддингами
              событий и находит темы даже без совпадения слов. Запрос учитывается
              как сильный сигнал интереса (×4), а скрытие карточки осаживает всю
              похожую тему.
            </p>
          )}
          {loading ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="card overflow-hidden">
                  <Skeleton className="h-40 w-full rounded-none" />
                  <div className="space-y-3 p-5">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : q && shown.length === 0 ? (
            <EmptyState
              title="Ничего не найдено"
              description={`По запросу «${searchText.trim()}» нет совпадений ни по тексту, ни по смыслу. Но запрос уже учтён — лента подстроится.`}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title="Событий пока нет"
              description="Создайте первое мероприятие — оно появится в ленте."
              actionHref="/my/events/new"
              actionLabel="Создать мероприятие"
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {shown.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  compact={event.format === "lecture"}
                  participantsCount={statsMap.get(event.id)?.participants_count}
                  tags={tagsByEvent.get(event.id) ?? []}
                  onHide={identity ? () => hideEvent(event.id) : undefined}
                  saved={identity ? isFavorite(event.id) : undefined}
                  onToggleSave={identity ? () => toggleFavorite(event.id) : undefined}
                  score={identity ? event.score : undefined}
                  matchCount={identity ? event.match_count : undefined}
                  explore={
                    identity && diversified.exploreIds.has(event.id)
                      ? true
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
