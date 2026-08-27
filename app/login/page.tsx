"use client";

import Link from "next/link";
import { useState } from "react";
import { useLogin } from "@refinedev/core";

export default function LoginPage() {
  const { mutate: login, isPending } = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    login(
      { email, password },
      {
        onError: (err) =>
          setError(
            (err as { message?: string })?.message ?? "Не удалось войти",
          ),
      },
    );
  }

  return (
    <div className="container-page flex max-w-md flex-col justify-center py-16">
      <h1 className="h1 text-center">Вход</h1>
      <p className="muted mt-2 text-center">
        Войдите, чтобы регистрироваться на события и управлять ими.
      </p>

      <form onSubmit={submit} className="card mt-8 space-y-4 p-6">
        <div>
          <label className="label">E-mail</label>
          <input
            className="input"
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Пароль</label>
          <input
            className="input"
            type="password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary w-full" disabled={isPending}>
          {isPending ? "Входим…" : "Войти"}
        </button>

        <p className="text-center text-sm text-muted">
          Нет аккаунта?{" "}
          <Link href="/register" className="font-semibold text-navy-800 hover:underline">
            Создать
          </Link>
        </p>
      </form>
    </div>
  );
}
