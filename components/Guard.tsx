"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useGetIdentity } from "@refinedev/core";
import type { Identity } from "@/lib/auth";
import { Spinner } from "./ui";

export function Guard({ children }: { children: React.ReactNode }) {
  const { data: identity, isLoading } = useGetIdentity<Identity | null>();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !identity) {
      router.push("/login");
    }
  }, [isLoading, identity, router]);

  if (isLoading || !identity) return <Spinner />;
  return <>{children}</>;
}
