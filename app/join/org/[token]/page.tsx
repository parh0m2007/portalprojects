"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase";

type Org = { id: string; name: string; slug: string };

export default function AcceptOrgInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [org, setOrg] = useState<Org | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabaseClient.auth.getUser();
      if (!userData.user) {
        router.push("/login");
        return;
      }
      const { data, error } = await supabaseClient.rpc(
        "accept_organization_invite",
        { invite_token: token },
      );
      if (error) {
        setState("error");
        setMessage(error.message);
      } else {
        setOrg(data as Org);
        setState("ok");
      }
    })();
  }, [token, router]);

  return (
    <div className="container-page flex min-h-[60vh] items-center justify-center py-10">
      <div className="card max-w-md p-8 text-center">
        {state === "loading" && <p className="muted">Принимаем приглашение…</p>}
        {state === "ok" && (
          <>
            <h1 className="h1">Вы в команде!</h1>
            <p className="muted mt-2">
              Приглашение в «{org?.name}» принято — теперь вам доступны события
              организации.
            </p>
            <Link href="/my/orgs" className="btn btn-accent mt-5">
              К организациям
            </Link>
          </>
        )}
        {state === "error" && (
          <>
            <h1 className="h1">Приглашение недоступно</h1>
            <p className="muted mt-2">{message}</p>
            <Link href="/" className="btn btn-ghost mt-5">
              На главную
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
