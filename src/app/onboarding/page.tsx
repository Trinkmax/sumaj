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

  return (
    <div className="flex min-h-dvh items-center justify-center bg-cream px-4">
      <div className="w-full max-w-md animate-slide-up-slow">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/viajerOS-2.png"
            alt="viajerOS"
            className="mx-auto h-9 w-auto"
          />
        </div>
        <OnboardingForm
          userId={user.id}
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
