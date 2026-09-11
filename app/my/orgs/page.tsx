"use client";

import { useState } from "react";
import { useGetIdentity, useNotification } from "@refinedev/core";
import { supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import { EmptyState, Spinner } from "@/components/ui";
import { Guard } from "@/components/Guard";

type Org = {
  id: string;
  name: string;
  slug: string;
  role: string;
  members_count: number;
  events_count: number;
};

type Member = {
  organization_id: string;
  user_id: string;
  role: string;
  profile: { full_name: string; email: string } | null;
};

function slugify(value: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
    ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
    я: "ya",
  };
  return value
    .toLowerCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function OrgsPageInner() {
  const { data: identity } = useGetIdentity<Identity | null>();
  const { open } = useNotification();

  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "manager">("manager");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function loadOrgs() {
    const { data, error } = await supabaseClient.rpc("my_organizations");
    if (error) {
      open?.({ type: "error", message: "Не удалось загрузить организации" });
      setOrgs([]);
    } else {
      setOrgs((data as Org[]) ?? []);
    }
    setLoaded(true);
  }

  async function loadMembers(orgId: string) {
    const { data, error } = await supabaseClient
      .from("organization_members")
      .select("organization_id, user_id, role, profiles(full_name, email)")
      .eq("organization_id", orgId);
    if (!error) {
      setMembers(
        ((data ?? []) as unknown as {
          organization_id: string;
          user_id: string;
          role: string;
          profiles: { full_name: string; email: string }[] | null;
        }[]).map((m) => ({
          organization_id: m.organization_id,
          user_id: m.user_id,
          role: m.role,
          profile: m.profiles?.[0] ?? null,
        })),
      );
    }
  }

  if (identity && !loaded) {
    loadOrgs();
  }

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabaseClient.rpc("create_organization", {
        name: name.trim(),
        slug: slug.trim(),
      });
      if (error) throw error;
      setName("");
      setSlug("");
      open?.({ type: "success", message: "Организация создана" });
      setLoaded(false);
    } catch (err) {
      open?.({
        type: "error",
        message: "Не удалось создать организацию",
        description: (err as { message?: string })?.message,
      });
    } finally {
      setBusy(false);
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOrg || !inviteEmail.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await supabaseClient.rpc(
        "invite_to_organization",
        {
          org: selectedOrg,
          invitee_email: inviteEmail.trim(),
          new_role: inviteRole,
        },
      );
      if (error) throw error;
      const token = (data as { token?: string } | null)?.token;
      open?.({
        type: "success",
        message: "Приглашение создано",
        description: token
          ? `Ссылка для принятия: /join/org?token=${token}`
          : undefined,
      });
      setInviteEmail("");
    } catch (err) {
      open?.({
        type: "error",
        message: "Не удалось пригласить",
        description: (err as { message?: string })?.message,
      });
    } finally {
      setBusy(false);
    }
  }

  if (!identity) return <Spinner />;

  return (
    <div className="container-page py-10">
      <h1 className="h1">Организации</h1>
      <p className="muted mt-1">
        Командные рабочие пространства: несколько организаторов ведут события
        вместе, судьи и API-ключи — общие.
      </p>

      {/* Создание */}
      <form onSubmit={createOrg} className="card mt-6 flex flex-wrap gap-3 p-5">
        <input
          className="input flex-1 min-w-48"
          placeholder="Название организации"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slug || slug === slugify(slug)) setSlug(slugify(e.target.value));
          }}
        />
        <input
          className="input w-56"
          placeholder="slug (латиница)"
          value={slug}
          onChange={(e) => setSlug(slugify(e.target.value))}
        />
        <button className="btn btn-accent" disabled={busy || !slug}>
          Создать
        </button>
      </form>

      {/* Список */}
      <div className="mt-8 grid gap-4">
        {!loaded ? (
          <Spinner />
        ) : (orgs ?? []).length === 0 ? (
          <EmptyState
            title="Нет организаций"
            description="Создайте организацию, чтобы работать над чемпионатами командой."
          />
        ) : (
          orgs!.map((org) => (
            <div key={org.id} className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold">{org.name}</h3>
                  <p className="muted text-sm">
                    @{org.slug} · вы: {org.role} · участников:{" "}
                    {org.members_count} · событий: {org.events_count}
                  </p>
                </div>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    if (selectedOrg === org.id) {
                      setSelectedOrg(null);
                    } else {
                      setSelectedOrg(org.id);
                      loadMembers(org.id);
                    }
                  }}
                >
                  {selectedOrg === org.id ? "Свернуть" : "Участники"}
                </button>
              </div>

              {selectedOrg === org.id && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <ul className="space-y-2 text-sm">
                    {members.map((m) => (
                      <li key={m.user_id} className="flex justify-between">
                        <span className="font-medium">
                          {m.profile?.full_name || m.profile?.email || m.user_id}
                        </span>
                        <span className="muted">{m.role}</span>
                      </li>
                    ))}
                  </ul>

                  <form onSubmit={invite} className="mt-4 flex flex-wrap gap-2">
                    <input
                      type="email"
                      required
                      className="input flex-1 min-w-48"
                      placeholder="e-mail для приглашения"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                    <select
                      className="input w-40"
                      value={inviteRole}
                      onChange={(e) =>
                        setInviteRole(e.target.value as "admin" | "manager")
                      }
                    >
                      <option value="manager">Менеджер</option>
                      <option value="admin">Администратор</option>
                    </select>
                    <button className="btn btn-primary" disabled={busy}>
                      Пригласить
                    </button>
                  </form>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function OrgsPage() {
  return (
    <Guard>
      <OrgsPageInner />
    </Guard>
  );
}
