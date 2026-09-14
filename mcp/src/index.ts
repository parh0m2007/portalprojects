#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, type ZodTypeAny } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabase, signInOrganizer, AuthError } from "./supabase.js";

const server = new McpServer(
  { name: "caseportal", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// ---------------------------------------------------------------
// Вход под организатором при старте (RLS пропускает его события)
// ---------------------------------------------------------------
let db: SupabaseClient;
try {
  db = createSupabase();
  await signInOrganizer(db);
} catch (err) {
  if (err instanceof AuthError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

// ---------- Вспомогательные ----------
const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

type Args = Record<string, unknown>;
type Result = ReturnType<typeof ok> | ReturnType<typeof fail>;

function tool(
  name: string,
  description: string,
  shape: Record<string, ZodTypeAny>,
  handler: (args: Args) => Promise<Result>,
) {
  server.tool(name, description, shape, async (args: Args) => {
    try {
      return await handler(args);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Неизвестная ошибка MCP";
      return fail(message);
    }
  });
}

async function currentUserId(): Promise<string | null> {
  const { data } = await db.auth.getUser();
  return data.user?.id ?? null;
}

type RegistrationRow = {
  id: string;
  status: string;
  contact: string;
  comment: string;
  created_at: string;
  teams?: { name: string }[] | { name: string } | null;
  cases?: { title: string }[] | { title: string } | null;
  solutions?: { id: string; title: string }[] | null;
};

function embedded<T>(value: T[] | T | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

// ---------------------------------------------------------------
// 1. create_event — событие с кейсами и критериями одним вызовом
// ---------------------------------------------------------------
tool(
  "create_event",
  "Создать мероприятие (кейс-чемпионат или лекцию) с кейсами и критериями оценки",
  {
    title: z.string().min(3).describe("Название мероприятия"),
    description: z.string().default("").describe("Описание"),
    format: z.enum(["case", "lecture"]).default("case"),
    place: z.string().default(""),
    starts_at: z.string().optional().describe("ISO-дата начала"),
    registration_deadline: z.string().optional().describe("ISO-дата дедлайна заявок"),
    capacity: z.number().int().positive().optional().describe("Лимит мест"),
    blind_judging: z.boolean().default(false).describe("Слепое судейство: судьи не видят авторов работ"),
    cases: z
      .array(z.object({ title: z.string(), description: z.string().default("") }))
      .default([])
      .describe("Кейсы чемпионата (для format=case)"),
    criteria: z
      .array(z.object({ title: z.string(), max_score: z.number().int().min(1).max(100).default(10) }))
      .default([])
      .describe("Критерии оценки судьями (для format=case)"),
  },
  async (args) => {
    const userId = await currentUserId();
    if (!userId) return fail("Нет сессии организатора");

    const { data: event, error } = await db
      .from("events")
      .insert({
        title: String(args.title),
        description: String(args.description ?? ""),
        format: args.format,
        place: String(args.place ?? ""),
        starts_at: args.starts_at ?? null,
        registration_deadline: args.registration_deadline ?? null,
        capacity: args.capacity ?? null,
        blind_judging: !!args.blind_judging,
        author_id: userId,
        status: "published",
      })
      .select()
      .single();
    if (error) return fail(`Не удалось создать мероприятие: ${error.message}`);

    const casesRows =
      (args.cases as { title: string; description?: string }[] | undefined) ?? [];
    if (casesRows.length > 0) {
      const { error: casesErr } = await db.from("cases").insert(
        casesRows.map((c) => ({
          event_id: event.id,
          title: c.title,
          description: c.description ?? "",
        })),
      );
      if (casesErr)
        return fail(`Событие создано, но кейсы — нет: ${casesErr.message}`);
    }

    const criteriaRows =
      (args.criteria as { title: string; max_score?: number }[] | undefined) ?? [];
    if (criteriaRows.length > 0) {
      const { error: critErr } = await db.from("criteria").insert(
        criteriaRows.map((c, i) => ({
          event_id: event.id,
          title: c.title,
          max_score: c.max_score ?? 10,
          sort_order: i,
        })),
      );
      if (critErr)
        return fail(`Событие создано, но критерии — нет: ${critErr.message}`);
    }

    return ok({
      created: true,
      event_id: event.id,
      url: `/events/${event.id}`,
      cases: casesRows.length,
      criteria: criteriaRows.length,
    });
  },
);

// ---------------------------------------------------------------
// 2. get_events — список мероприятий организатора
// ---------------------------------------------------------------
tool(
  "get_events",
  "Список мероприятий организатора со статистикой (заявки, решения)",
  {
    status: z.enum(["draft", "published", "finished"]).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  },
  async (args) => {
    let query = db
      .from("events")
      .select(
        "id, title, format, status, starts_at, capacity, organization_id, blind_judging, created_at",
      )
      .order("created_at", { ascending: false })
      .limit((args.limit as number) ?? 20);
    if (args.status) query = query.eq("status", args.status as string);

    const { data: events, error } = await query;
    if (error) return fail(error.message);

    const { data: stats } = await db
      .from("event_stats")
      .select("event_id, participants_count, approved_count, solutions_count");
    const statsMap = new Map(
      (stats ?? []).map((s: Record<string, unknown>) => [
        s.event_id as string,
        s,
      ]),
    );

    return ok(
      (events ?? []).map((e: Record<string, unknown>) => ({
        id: e.id,
        title: e.title,
        format: e.format,
        status: e.status,
        starts_at: e.starts_at,
        capacity: e.capacity,
        blind_judging: e.blind_judging,
        participants:
          (statsMap.get(e.id as string)?.participants_count as number) ?? 0,
        solutions:
          (statsMap.get(e.id as string)?.solutions_count as number) ?? 0,
      })),
    );
  },
);

// ---------------------------------------------------------------
// 3. Заявки: список и смена статуса
// ---------------------------------------------------------------
tool(
  "list_applications",
  "Заявки на событие: команды, контакты, статусы",
  {
    event_id: z.string().uuid(),
    status: z
      .enum(["pending", "approved", "rejected", "waitlist"])
      .optional(),
  },
  async (args) => {
    let query = db
      .from("registrations")
      .select("id, status, contact, comment, created_at, teams(name), cases(title)")
      .eq("event_id", args.event_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (args.status) query = query.eq("status", args.status as string);

    const { data: regs, error } = await query;
    if (error) return fail(error.message);

    const byStatus: Record<string, number> = {};
    const regRows = (regs ?? []) as unknown as RegistrationRow[];
    for (const r of regRows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

    return ok({
      total: regs?.length ?? 0,
      by_status: byStatus,
      applications: regRows.map(
        (r) => ({
          id: r.id,
          team: embedded(r.teams)?.name ?? null,
          case: embedded(r.cases)?.title ?? null,
          status: r.status,
          contact: r.contact,
          comment: r.comment,
          created_at: r.created_at,
        }),
      ),
    });
  },
);

tool(
  "set_application_status",
  "Одобрить / отклонить заявку или перевести в лист ожидания",
  {
    registration_id: z.string().uuid(),
    status: z.enum(["approved", "rejected", "waitlist", "pending"]),
  },
  async (args) => {
    const { error } = await db
      .from("registrations")
      .update({ status: args.status })
      .eq("id", args.registration_id);
    if (error) return fail(error.message);
    return ok({ updated: true, status: args.status });
  },
);

// ---------------------------------------------------------------
// 4. invite_judges — назначение судей по e-mail
// ---------------------------------------------------------------
tool(
  "invite_judges",
  "Пригласить судей на событие по e-mail (пользователи должны быть зарегистрированы)",
  {
    event_id: z.string().uuid(),
    emails: z.array(z.string().email()).min(1),
  },
  async (args) => {
    const emails = (args.emails as string[]).map((e) => e.toLowerCase());
    const { data: profiles, error: profErr } = await db
      .from("profiles")
      .select("id, email")
      .in("email", emails);
    if (profErr) return fail(profErr.message);

    const found = new Map(
      (profiles ?? []).map((p: Record<string, string>) => [
        p.email.toLowerCase(),
        p.id,
      ]),
    );
    const missing = emails.filter((e) => !found.has(e));

    const rows = (profiles ?? []).map((p: Record<string, string>) => ({
      event_id: args.event_id as string,
      user_id: p.id,
    }));
    let invited = 0;
    let duplicates = 0;
    if (rows.length > 0) {
      const { data, error } = await db
        .from("event_judges")
        .upsert(rows, { onConflict: "event_id,user_id", ignoreDuplicates: true })
        .select();
      if (error) return fail(error.message);
      invited = data?.length ?? 0;
      duplicates = rows.length - invited;
    }

    return ok({ invited, duplicates, not_registered: missing });
  },
);

// ---------------------------------------------------------------
// 5. get_works + draft_scores — решения и черновик оценок
// ---------------------------------------------------------------
tool(
  "get_works",
  "Решения события (для судьи/организатора): названия, команды, баллы",
  { event_id: z.string().uuid() },
  async (args) => {
    const { data, error } = await db
      .from("solution_cards")
      .select(
        "id, title, team_name, case_title, status, total_score, judges_count, created_at",
      )
      .eq("event_id", args.event_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return fail(error.message);
    return ok({ works: data ?? [] });
  },
);

tool(
  "draft_scores",
  "Сформировать черновик оценок работы по критериям события (судья подтверждает на портале)",
  {
    solution_id: z.string().uuid(),
    analysis: z
      .array(
        z.object({
          criterion: z.string().describe("Название критерия"),
          score: z.number().int().min(0),
          reasoning: z.string().default(""),
        }),
      )
      .min(1)
      .describe("Предлагаемые баллы по критериям с обоснованием"),
  },
  async (args) => {
    const { data: card } = await db
      .from("solution_cards")
      .select("id, event_id, title, total_score, judges_count")
      .eq("id", args.solution_id)
      .single();
    if (!card) return fail("Решение не найдено");

    const { data: criteria } = await db
      .from("criteria")
      .select("id, title, max_score, sort_order")
      .eq("event_id", card.event_id)
      .order("sort_order");
    if (!criteria || criteria.length === 0)
      return fail("У события не заданы критерии оценки");

    // Черновик НЕ пишется в scores: судья подтверждает его в UI (/judge/review/[id])
    const draft = (
      args.analysis as { criterion: string; score: number; reasoning?: string }[]
    ).map((a) => {
      const cr = criteria.find((c: Record<string, unknown>) => c.title === a.criterion);
      return {
        criterion_id: (cr?.id as string) ?? null,
        criterion: a.criterion,
        max_score: (cr?.max_score as number) ?? null,
        proposed_score: Math.min(a.score, (cr?.max_score as number) ?? a.score),
        reasoning: a.reasoning ?? "",
        valid: !!cr,
      };
    });

    const invalid = draft.filter((d) => !d.valid).map((d) => d.criterion);
    if (invalid.length > 0)
      return fail(`Неизвестные критерии: ${invalid.join(", ")}`);

    return ok({
      solution_id: args.solution_id,
      solution_title: card.title,
      review_url: `/judge/review/${args.solution_id}`,
      note: "Черновик не сохранён — судья подтверждает баллы на портале",
      draft,
    });
  },
);

// ---------------------------------------------------------------
// 6. publish_results — публикация итогов
// ---------------------------------------------------------------
tool(
  "publish_results",
  "Опубликовать итоги события (решения и оценки становятся публичными, участники получают уведомления)",
  { event_id: z.string().uuid() },
  async (args) => {
    const { error } = await db.rpc("publish_results", { ev: args.event_id });
    if (error) return fail(error.message);
    return ok({ published: true, event_id: args.event_id });
  },
);

// ---------------------------------------------------------------
// 7. export_report — отчёт по событию
// ---------------------------------------------------------------
tool(
  "export_report",
  "Отчёт по событию: воронка заявок, статистика, лидерборд с нормализацией оценок",
  { event_id: z.string().uuid() },
  async (args) => {
    const [statsRes, regsRes, boardRes] = await Promise.all([
      db.from("event_stats").select("*").eq("event_id", args.event_id).single(),
      db
        .from("registrations")
        .select("id, status, contact, teams(name), cases(title)")
        .eq("event_id", args.event_id)
        .limit(500),
      db.rpc("normalized_leaderboard", { ev: args.event_id }),
    ]);

    const funnel: Record<string, number> = {};
    for (const r of (regsRes.data ?? []) as unknown as RegistrationRow[])
      funnel[r.status] = (funnel[r.status] ?? 0) + 1;

    return ok({
      stats: statsRes.data,
      funnel,
      leaderboard_normalized: boardRes.data ?? [],
    });
  },
);

// ---------------------------------------------------------------
// 8. Организации (мультиарендность)
// ---------------------------------------------------------------
tool(
  "create_organization",
  "Создать организацию (рабочее пространство команды организаторов)",
  {
    name: z.string().min(2),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "строчные латиница, цифры и дефисы"),
  },
  async (args) => {
    const { data, error } = await db.rpc("create_organization", {
      name: args.name,
      slug: args.slug,
    });
    if (error) return fail(error.message);
    return ok(data);
  },
);

tool(
  "invite_to_organization",
  "Пригласить пользователя в организацию по e-mail (роль admin/manager)",
  {
    org_id: z.string().uuid(),
    email: z.string().email(),
    role: z.enum(["admin", "manager"]).default("manager"),
  },
  async (args) => {
    const { data, error } = await db.rpc("invite_to_organization", {
      org: args.org_id,
      invitee_email: args.email,
      new_role: args.role,
    });
    if (error) return fail(error.message);
    return ok({
      invited: true,
      email: args.email,
      role: args.role,
      invite_token: (data as { token?: string } | null)?.token ?? null,
    });
  },
);

tool(
  "transfer_event_to_organization",
  "Перенести событие в организацию (командная работа над чемпионатом)",
  {
    event_id: z.string().uuid(),
    org_id: z.string().uuid(),
  },
  async (args) => {
    const { error } = await db.rpc("transfer_event_to_organization", {
      ev: args.event_id,
      org: args.org_id,
    });
    if (error) return fail(error.message);
    return ok({ transferred: true });
  },
);

// ---------------------------------------------------------------
// 9. Витрина изобретений (Союз изобретателей)
// ---------------------------------------------------------------
tool(
  "list_inventions",
  "Витрина изобретений Союза: стадия, патентный статус, сферы, цель инвестиций",
  {
    stage: z
      .enum(["idea", "prototype", "mvp", "patent_pending", "patented", "market"])
      .optional()
      .describe("Фильтр по стадии готовности"),
    sector: z.string().optional().describe("Фильтр по сфере (подстрока)"),
    limit: z.number().int().min(1).max(100).default(20),
  },
  async (args) => {
    let query = db
      .from("invention_cards")
      .select(
        "id, title, summary, stage, patent_status, sectors, funding_goal, visibility, author_name, created_at",
      )
      .order("created_at", { ascending: false })
      .limit((args.limit as number) ?? 20);
    if (args.stage) query = query.eq("stage", args.stage as string);

    const { data: inventions, error } = await query;
    if (error) return fail(error.message);

    const sector = String(args.sector ?? "").toLowerCase();
    return ok(
      (inventions ?? [])
        .filter(
          (i: { sectors?: string[] }) =>
            !sector ||
            (i.sectors ?? []).some((s) => s.toLowerCase().includes(sector)),
        )
        .map((i: Record<string, unknown>) => ({
          id: i.id,
          title: i.title,
          summary: i.summary,
          stage: i.stage,
          patent_status: i.patent_status,
          sectors: i.sectors,
          funding_goal: i.funding_goal,
          visibility: i.visibility,
          author: i.author_name,
          created_at: i.created_at,
        })),
    );
  },
);

tool(
  "match_investors",
  "Подобрать инвесторов под изобретение (секторы + семантика тезиса)",
  {
    invention_id: z.string().uuid(),
    limit: z.number().int().min(1).max(20).default(5),
  },
  async (args) => {
    const { data, error } = await db.rpc("recommended_investors", {
      inv: args.invention_id,
      limit_count: (args.limit as number) ?? 5,
    });
    if (error) return fail(error.message);
    return ok({ investors: data ?? [] });
  },
);

tool(
  "request_mentor",
  "Отправить заявку на наставничество от имени авторизованного пользователя",
  {
    mentor_user_id: z.string().uuid().describe("ID профиля наставника"),
    topic: z.string().min(3).describe("Тема: чем нужна помощь"),
    message: z.string().default(""),
    invention_id: z.string().uuid().optional().describe("Контекст: ID изобретения"),
  },
  async (args) => {
    const userId = await currentUserId();
    if (!userId) return fail("Нет сессии организатора");

    const { error } = await db.from("mentorship_requests").insert({
      mentor_id: args.mentor_user_id,
      mentee_id: userId,
      invention_id: args.invention_id ?? null,
      topic: String(args.topic),
      message: String(args.message ?? ""),
    });
    if (error) return fail(error.message);
    return ok({ requested: true, mentor_id: args.mentor_user_id });
  },
);

// ---------------------------------------------------------------
// Старт
// ---------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
