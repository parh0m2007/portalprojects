"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  useOne,
  useList,
  useGetIdentity,
  useCreate,
  useNotification,
} from "@refinedev/core";
import type { Identity } from "@/lib/auth";
import type { EventRecord } from "@/components/EventCard";
import {
  EmptyState,
  Field,
  FormatBadge,
  Spinner,
  formatDate,
  isRegistrationClosed,
} from "@/components/ui";
import { Guard } from "@/components/Guard";

type CaseRecord = {
  id: string;
  event_id: string;
  title: string;
  description: string;
};

type EventStats = {
  event_id: string;
  approved_count: number;
  capacity: number | null;
  seats_left: number | null;
};

function Stepper({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}) {
  return (
    <div className="flex items-center">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2.5">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition ${
                  done
                    ? "bg-green-500 text-white"
                    : active
                      ? "bg-navy-800 text-white"
                      : "border border-slate-300 bg-white text-muted"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={`hidden text-sm font-semibold sm:block ${
                  active ? "text-ink" : "text-muted"
                }`}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`mx-3 h-0.5 flex-1 rounded ${
                  done ? "bg-green-500" : "bg-slate-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function RegisterWizard() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { open } = useNotification();
  const { data: identity } = useGetIdentity<Identity | null>();

  const { result: event, query } = useOne<EventRecord>({
    resource: "events",
    id,
  });
  const casesQuery = useList<CaseRecord>({
    resource: "cases",
    filters: [{ field: "event_id", operator: "eq", value: id as string }],
    sorters: [{ field: "created_at", order: "asc" }],
    pagination: { pageSize: 50 },
  });
  const statsQuery = useList<EventStats>({
    resource: "event_stats",
    filters: [{ field: "event_id", operator: "eq", value: id as string }],
    pagination: { pageSize: 1 },
  });
  const seatsLeft = statsQuery.result.data?.[0]?.seats_left ?? null;

  const { mutate: createTeam } = useCreate();
  const { mutate: createRegistration } = useCreate();

  const [step, setStep] = useState(0);
  const [teamName, setTeamName] = useState("");
  const [caseId, setCaseId] = useState<string>("");
  const [contact, setContact] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (query.isLoading) return <Spinner />;
  if (!event)
    return (
      <EmptyState
        title="Мероприятие не найдено"
        actionHref="/"
        actionLabel="К витрине событий"
      />
    );

  const isCaseFormat = event.format === "case";
  const cases = casesQuery.result.data ?? [];
  const closed = isRegistrationClosed(event);
  const selectedCase = cases.find((c) => c.id === caseId);

  const steps = isCaseFormat
    ? ["Команда", "Кейс", "Контакты"]
    : ["О вас", "Проверка"];
  const lastStep = steps.length - 1;

  if (closed) {
    return (
      <div className="container-page max-w-2xl py-16">
        <EmptyState
          title="Приём заявок закрыт"
          description={
            event.registration_deadline
              ? `Запись на «${event.title}» завершилась ${formatDate(event.registration_deadline)}.`
              : "Запись на это мероприятие завершена."
          }
          actionHref="/"
          actionLabel="Найти другое событие"
        />
      </div>
    );
  }

  function validateCurrent(): string | null {
    if (isCaseFormat && step === 0 && !teamName.trim())
      return "Укажите название команды";
    if (isCaseFormat && step === 1 && cases.length > 0 && !caseId)
      return "Выберите кейс, который будет решать команда";
    return null;
  }

  function next() {
    const err = validateCurrent();
    if (err) return setError(err);
    setError(null);
    setStep((s) => Math.min(s + 1, lastStep));
  }

  function submit() {
    if (!identity) return;
    const err = validateCurrent();
    if (err) return setError(err);
    setError(null);
    setSaving(true);

    const registerWithTeam = (teamId?: string) => {
      const waitlisted = seatsLeft !== null && seatsLeft <= 0;
      createRegistration(
        {
          resource: "registrations",
          values: {
            event_id: event!.id,
            user_id: identity!.id,
            team_id: teamId ?? null,
            case_id: isCaseFormat && caseId ? caseId : null,
            contact,
            comment,
            status: waitlisted ? "waitlist" : "pending",
          },
        },
        {
          onSuccess: () => {
            open?.({
              type: "success",
              message: waitlisted
                ? "Вы в листе ожидания"
                : "Заявка отправлена",
              description: waitlisted
                ? "Мест сейчас нет — организатор уведомит, если они появятся."
                : "Организатор рассмотрит её и подтвердит участие.",
            });
            router.push("/my/registrations");
          },
          onError: (err) => {
            setSaving(false);
            const msg =
              (err as { message?: string })?.message ??
              "Не удалось отправить заявку";
            setError(
              msg.includes("duplicate")
                ? "Вы уже зарегистрированы на это мероприятие"
                : msg,
            );
          },
        },
      );
    };

    if (isCaseFormat && teamName.trim()) {
      createTeam(
        {
          resource: "teams",
          values: { name: teamName.trim(), captain_id: identity.id },
        },
        {
          onSuccess: (data) => {
            registerWithTeam(
              (data?.data as { id?: string } | undefined)?.id,
            );
          },
          onError: (err) => {
            setSaving(false);
            setError(
              (err as { message?: string })?.message ??
                "Не удалось создать команду",
            );
          },
        },
      );
    } else {
      registerWithTeam();
    }
  }

  return (
    <div className="container-page max-w-3xl py-10">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/" className="hover:text-navy-800">
          События
        </Link>
        <span>/</span>
        <Link href={`/events/${id}`} className="hover:text-navy-800">
          {event.title}
        </Link>
        <span>/</span>
        <span className="font-medium text-ink">Регистрация</span>
      </div>

      <h1 className="h1">Регистрация на мероприятие</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <FormatBadge format={event.format} />
        <span className="muted">Начало: {formatDate(event.starts_at)}</span>
        {event.registration_deadline && (
          <span className="badge badge-gold">
            Запись до {formatDate(event.registration_deadline)}
          </span>
        )}
      </div>

      <div className="card mt-6 p-6 md:p-8">
        <Stepper steps={steps} current={step} />

        <div className="mt-8">
          {/* Шаг 1: команда (кейс) или о вас (лекция) */}
          {isCaseFormat && step === 0 && (
            <Field label="Название команды" required hint="Придумайте короткое и запоминающееся">
              <input
                className="input"
                placeholder="Например, «Вольт»"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                autoFocus
              />
            </Field>
          )}
          {!isCaseFormat && step === 0 && (
            <div className="grid gap-5">
              <Field label="Контакт для связи" hint="Telegram, e-mail или телефон">
                <input
                  className="input"
                  placeholder="@nickname"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
              </Field>
              <Field label="Комментарий организатору">
                <textarea
                  className="input min-h-20"
                  placeholder="Пожелания, вопросы"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </Field>
            </div>
          )}

          {/* Шаг 2: выбор кейса */}
          {isCaseFormat && step === 1 && (
            <div>
              <label className="label">
                Кейс для решения<span className="ml-0.5 text-rose-500">*</span>
              </label>
              {cases.length === 0 ? (
                <p className="muted">Кейсы будут опубликованы позже.</p>
              ) : (
                <div className="grid gap-3">
                  {cases.map((c, i) => (
                    <label
                      key={c.id}
                      className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition ${
                        caseId === c.id
                          ? "border-navy-800 bg-navy-50 ring-2 ring-navy-800/15"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="case"
                        className="mt-1 accent-[#16305f]"
                        checked={caseId === c.id}
                        onChange={() => setCaseId(c.id)}
                      />
                      <span>
                        <span className="block font-bold">
                          Кейс {i + 1}. {c.title}
                        </span>
                        <span className="muted mt-1 block">{c.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Последний шаг */}
          {step === lastStep && (
            <div className="grid gap-5">
              <Field label="Контакт для связи" hint="Telegram, e-mail или телефон">
                <input
                  className="input"
                  placeholder="@nickname"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
              </Field>
              <Field label="Комментарий организатору">
                <input
                  className="input"
                  placeholder="Пожелания, вопросы"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </Field>

              <div className="rounded-xl bg-navy-50 p-4">
                <p className="text-sm font-bold">Проверьте заявку</p>
                {seatsLeft !== null && seatsLeft <= 0 && (
                  <p className="mt-2 rounded-lg bg-gold-100 px-3 py-2 text-xs font-medium text-[#92610a]">
                    Свободных мест нет — заявка попадёт в лист ожидания.
                  </p>
                )}
                <dl className="mt-2 space-y-1 text-sm text-slate-700">
                  {isCaseFormat && (
                    <>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted">Команда</dt>
                        <dd className="font-semibold">{teamName || "—"}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted">Кейс</dt>
                        <dd className="text-right font-semibold">
                          {selectedCase?.title ?? "—"}
                        </dd>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Мероприятие</dt>
                    <dd className="text-right font-semibold">{event.title}</dd>
                  </div>
                </dl>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
            {error}
          </p>
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          {step > 0 ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setError(null);
                setStep((s) => s - 1);
              }}
            >
              ← Назад
            </button>
          ) : (
            <Link href={`/events/${id}`} className="btn btn-ghost">
              Отмена
            </Link>
          )}

          {step < lastStep ? (
            <button type="button" className="btn btn-primary" onClick={next}>
              Далее: {steps[step + 1]} →
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-accent"
              onClick={submit}
              disabled={saving}
            >
              {saving ? "Отправляем…" : "Отправить заявку"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function EventRegisterPage() {
  return (
    <Guard>
      <RegisterWizard />
    </Guard>
  );
}
