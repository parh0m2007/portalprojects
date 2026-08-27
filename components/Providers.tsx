"use client";

import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/nextjs-router";
import { dataProvider } from "@refinedev/supabase";
import { supabaseClient } from "@/lib/supabase";
import { authProvider } from "@/lib/auth";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Refine
      routerProvider={routerProvider}
      dataProvider={dataProvider(supabaseClient)}
      authProvider={authProvider}
      resources={[
        { name: "events", list: "/" },
        { name: "leaderboard", list: "/leaderboard" },
        { name: "my-events", list: "/my" },
        { name: "my-registrations", list: "/my/registrations" },
        { name: "judge", list: "/judge" },
      ]}
      options={{ syncWithLocation: false, warnWhenUnsavedChanges: false }}
    >
      {children}
    </Refine>
  );
}
