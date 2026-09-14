"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useOne, useList, useGetIdentity, useNotification } from "@refinedev/core";
import { supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import { EmptyState, Spinner, StatusBadge } from "@/components/ui";
import {
  STAGE_LABELS,
  VISIBILITY_LABELS,
  formatMoney,
  type InventionCard,
} from "@/components/inventors/shared";

type RecommendedInvestor = {
  user_id: string;
  name: string;
  kind: string;
  thesis: string;
  sectors: string[];
  ticket_min: number | null;
  ticket_max: number | null;
  website: string;
  score: number;
};

type ContactRequestRow = {
  id: string;
  invention_id: string;
  investor_id: string;
  message: string;
  status: string;
};

const INVESTOR_KIND_LABELS: Record<string, string> = {
  angel: "Частный инвестор",
  fund: "Фонд",
  corporate: "Корпорация",
  government: "Госинститут",
};

export default function InventionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: identity } = useGetIdentity<Identity | null>();
  const { open } = useNotification();
  const [recommended, setRecommended] = useState<RecommendedInvestor[]>([]);
  const [myRequest, setMyRequest] = useState<ContactRequestRow | null>(null);
  const [pitchUrl, setPitchUrl] = useState<string | null>(null);
  const [showContact, setShowContact] = useState(false);
  const [contactMessage, setContactMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const { result: inv, query } = useOne<InventionCard>({
    resource: "invention_cards",
    id,
  });

  // Рекомендованные инвесторы для изобретения (секторы + эмбеддинги)
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.resolve(supabaseClient.rpc("recommended_investors", { inv: id, limit_count: 6 }))
      .then(({ data }) => {
        if (!cancelled) setRecommended((data as RecommendedInvestor[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setRecommended([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Моя заявка на контакт (если я инвестор)
  useEffect(() => {
    if (!id || !identity) return;
    let cancelled = false;
    Promise.resolve(
      supabaseClient
        .from("contact_requests")
        .select("id, invention_id, investor_id, message, status")
        .eq("invention_id", id)
        .eq("investor_id", identity.id)
        .maybeSingle(),
    )
      .then(({ data }) => {
        if (!cancelled) setMyRequest((data as ContactRequestRow) ?? null);
      })
      .catch(() => {
        if (!cancelled) setMyRequest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id, identity]);

  // Питч-дек из Storage
  useEffect(() => {
    if (!inv?.pitch_path) return;
    supabaseClient.storage
      .from("inventions")
      .createSignedUrl(inv.pitch_path, 3600)
      .then(({ data }) => setPitchUrl(data?.signedUrl ?? null))
      .catch(() => setPitchUrl(null));
  }, [inv?.pitch_path]);

  async function submitContact() {
    if (!inv || !identity) return;
    setBusy(true);
    try {
      const { error } = await supabaseClient.from("contact_requests").insert({
        invention_id: inv.id,
        investor_id: identity.id,
        message: contactMessage.trim(),
      });
      if (error) throw error;
      setMyRequest({
        id: "",
        invention_id: inv.id,
        investor_id: identity.id,
        message: contactMessage.trim(),
        status: "pending",
      });
      setShowContact(false);
      open?.({
        type: "success",
        message: "Заявка отправлена",
        description: "Автор изобретения получит уведомление.",
      });
    } catch (err) {
      open?.({
        type: "error",
        message: "Не удалось отправить заявку",
        description: (err as { message?: string })?.message,
      });
    } finally {
      setBusy(false);
    }
  }

  async function withdrawRequest() {
    if (!myRequest?.id) return;
    const { error } = await supabaseClient
      .from("contact_requests")
      .update({ status: "withdrawn" })
      .eq("id", myRequest.id);
    if (!error) setMyRequest({ ...myRequest, status: "withdrawn" });
  }

  if (query.isLoading) return <Spinner />;
  if (!inv) {
    return (
      <div className="container-page py-16">
        <EmptyState
          title="Изобретение недоступно"
          description="Возможно, оно видно только одобренным инвесторам или автор скрыл его."
        />
      </div>
    );
  }

  const isAuthor = identity?.id === inv.author_id;
  const pitchLink = pitchUrl ? (
    <a href={pitchUrl} target="_blank" rel="noreferrer" className="btn btn-ghost !py-2">
      Питч-дек
    </a>
  ) : null;

  return (
    <div className="container-page max-w-4xl py-10">
      <Link href="/inventions" className="meta hover:text-ink">
        ← Витрина изобретений
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="h1">{inv.title}</h1>
          <p className="meta mt-2">
            {inv.author_name}
            {inv.event_title && (
              <>
                {" · "}
                <Link href={`/events/${inv.event_id}`} className="text-navy hover:underline">
                  {inv.event_title}
                </Link>
              </>
            )}
          </p>
        </div>
        <span className="badge badge-gold">
          {STAGE_LABELS[inv.stage] ?? inv.stage}
        </span>
      </div>

      <div className="card mt-6 space-y-5 p-6 md:p-8">
        {inv.summary && <p className="text-base font-semibold">{inv.summary}</p>}
        {inv.description && (
          <p className="whitespace-pre-line text-sm leading-relaxed">{inv.description}</p>
        )}

        <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-line pt-4">
          {inv.patent_status && (
            <div>
              <p className="meta">Патент</p>
              <p className="text-sm font-semibold">{inv.patent_status}</p>
            </div>
          )}
          {inv.funding_goal != null && (
            <div>
              <p className="meta">Цель инвестиций</p>
              <p className="text-sm font-semibold">{formatMoney(inv.funding_goal)}</p>
            </div>
          )}
          <div>
            <p className="meta">Видимость</p>
            <p className="text-sm font-semibold">{VISIBILITY_LABELS[inv.visibility]}</p>
          </div>
          {inv.contacts_count > 0 && (
            <div>
              <p className="meta">Контактов</p>
              <p className="text-sm font-semibold">{inv.contacts_count}</p>
            </div>
          )}
        </div>

        {inv.sectors.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-line pt-4">
            {inv.sectors.map((s) => (
              <span
                key={s}
                className="border border-line px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ink"
              >
                {s}
              </span>
            ))}
          </div>
        )}

        {isAuthor && pitchLink}
      </div>

      {/* Действия инвестора */}
      {!isAuthor && identity && (
        <div className="mt-6">
          {myRequest ? (
            <div className="card flex flex-wrap items-center gap-4 p-5">
              <span className="text-sm font-semibold">Ваша заявка на контакт</span>
              <StatusBadge status={myRequest.status} />
              {myRequest.status === "pending" && myRequest.id && (
                <button
                  onClick={withdrawRequest}
                  className="btn btn-ghost !py-2 text-sm"
                >
                  Отозвать
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={() => setShowContact((v) => !v)}
                className="btn btn-primary"
              >
                Связаться с автором
              </button>
              {showContact && (
                <div className="card space-y-3 p-5">
                  <textarea
                    className="input min-h-24"
                    placeholder="Коротко: кто вы, почему интересно, что предлагаете"
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                  />
                  <button
                    onClick={submitContact}
                    disabled={busy}
                    className="btn btn-accent"
                  >
                    {busy ? "Отправка…" : "Отправить заявку"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Рекомендованные инвесторы */}
      {isAuthor && recommended.length > 0 && (
        <div className="mt-8">
          <h2 className="h2">Рекомендованные инвесторы</h2>
          <p className="muted mt-1">
            Подобраны по сферам и смыслу описания — подайте им заявку напрямую.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {recommended.map((r) => (
              <div key={r.user_id} className="card space-y-2 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">{r.name || "Инвестор"}</p>
                    <p className="meta">
                      {INVESTOR_KIND_LABELS[r.kind] ?? r.kind}
                    </p>
                  </div>
                  <span className="badge badge-navy">Совпадение {r.score}</span>
                </div>
                {r.thesis && <p className="muted line-clamp-3 text-xs">{r.thesis}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
