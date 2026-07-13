import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/types";

export type Member = Tables<"members">;
export type Agency = Tables<"agencies">;

export type MemberContext = {
  member: Member;
  agency: Agency;
  /** Miembros activos de la agencia (para asignaciones, filtros, etc.) */
  isAdmin: boolean;
  isStaff: boolean;
};

/**
 * Contexto del usuario logueado, cacheado por request.
 * null si no hay sesión o si todavía no pertenece a ninguna agencia.
 */
export const getMemberContext = cache(async (): Promise<MemberContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("members")
    .select("*, agency:agencies(*)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!data || !data.agency) return null;

  const { agency, ...member } = data;
  return {
    member: member as Member,
    agency: agency as Agency,
    isAdmin: member.role === "admin",
    isStaff: member.role === "admin" || member.role === "vendedor",
  };
});

/**
 * Para páginas del app: exige sesión + membresía.
 * Sin sesión → /login. Con sesión sin agencia → /onboarding.
 */
export async function requireMember(): Promise<MemberContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await getMemberContext();
  if (!ctx) redirect("/onboarding");
  return ctx;
}
