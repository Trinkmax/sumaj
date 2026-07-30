import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMemberContext } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Empezar" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await getMemberContext();
  if (ctx) redirect("/inicio");

  // ¿tiene una invitación pendiente a alguna agencia?
  const { data: invitation } = await supabase
    .from("invitations")
    .select("id, agency_id, role, display_name, commission_pct, agency:agencies(name)")
    .ilike("email", user.email ?? "")
    .is("accepted_at", null)
    .limit(1)
    .maybeSingle();

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email?.split("@")[0] ??
    "";

  // members.email se guarda normalizado: es la vara con la que el alta de equipo
  // busca duplicados y lo que se muestra en /config y /config/equipo
  const email = user.email?.trim().toLowerCase() || null;

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-cream px-4 py-10">
      {/* halo editorial de marca, sutil en ambos temas */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[38rem] -translate-x-1/2 rounded-full bg-brand-tint opacity-70 blur-3xl"
      />

      <div className="relative w-full max-w-md animate-slide-up-slow">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/viajerOS-2.png"
            alt="viajerOS"
            className="mx-auto h-8 w-auto dark:invert"
          />
        </div>
        <OnboardingForm
          userId={user.id}
          email={email}
          fullName={fullName}
          invitation={
            invitation
              ? {
                  id: invitation.id,
                  agencyId: invitation.agency_id,
                  agencyName:
                    (invitation.agency as { name: string } | null)?.name ?? "tu agencia",
                  role: invitation.role,
                  displayName: invitation.display_name,
                  commissionPct: invitation.commission_pct,
                }
              : null
          }
        />
      </div>
    </div>
  );
}
