import type { AuthProvider } from "@refinedev/core";
import { supabaseClient } from "./supabase";

export type Identity = {
  id: string;
  email: string;
  full_name: string;
};

export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return { success: false, error };
    return { success: true, redirectTo: "/" };
  },

  register: async ({ email, password, full_name }) => {
    const { error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { full_name } },
    });
    if (error) return { success: false, error };
    return { success: true, redirectTo: "/login" };
  },

  logout: async () => {
    await supabaseClient.auth.signOut();
    return { success: true, redirectTo: "/" };
  },

  check: async () => {
    const { data } = await supabaseClient.auth.getUser();
    return { authenticated: !!data.user };
  },

  getIdentity: async () => {
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .maybeSingle();
    return {
      id: user.id,
      email: profile?.email || user.email || "",
      full_name: profile?.full_name || "",
    } satisfies Identity;
  },

  onError: async (error) => ({ error }),
};
