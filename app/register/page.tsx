"use client";

import Link from "next/link";
import { useState } from "react";
import { useRegister } from "@refinedev/core";

export default function RegisterPage() {
  const { mutate: register, isPending } = useRegister();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    register(
      { email, password, full_name: fullName },
      {
        onError: (err) =>
          setError(
            (err as { message?: string })?.message ??
              "Не удалось создать аккаунт",
          ),
      },
    );
  }

  return (
    <div className="container-page flex max-w-md flex-col justify-center py-16">
      <h1 className="h1 text-center">Создать аккаунт</h1>
      <p className="muted mt-2 text-center">
        Участвуйте в событиях, создавайте свои и становитесь судьёй.
      </p>

      <form onSubmit={submit} className="card mt-8 space-y-4 p-6">
        <div>
          <label className="label">Имя и фамилия</label>
          <input
            className="input"
            required
            placeholder="Анна К."
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
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
            minLength={6}
            placeholder="Минимум 6 символов"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-accent w-full" disabled={isPending}>
          {isPending ? "Создаём…" : "Зарегистрироваться"}
        </button>

        <p className="text-center text-sm text-muted">
          Уже есть аккаунт?{" "}
          <Link href="/login" className="font-semibold text-navy-800 hover:underline">
            Войти
          </Link>
        </p>
      </form>
    </div>
  );
}
