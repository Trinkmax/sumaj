"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { MemberRole } from "@/lib/types";

type Invitation = {
  id: string;
  agencyId: string;
  agencyName: string;
  role: MemberRole;
  displayName: string | null;
  commissionPct: number;
};

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "agencia"
  );
}

export function OnboardingForm({
  userId,
  fullName,
  invitation,
}: {
  userId: string;
  fullName: string;
  invitation: Invitation | null;
}) {
  const [agencyName, setAgencyName] = useState("");
  const [displayName, setDisplayName] = useState(fullName.split(" ")[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function acceptInvitation() {
    if (!invitation) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const { error: memberError } = await supabase.from("members").insert({
      agency_id: invitation.agencyId,
      user_id: userId,
      role: invitation.role,
      display_name: invitation.displayName ?? displayName ?? fullName,
      commission_pct: invitation.commissionPct,
    });
    if (memberError) {
      setError("No pudimos sumarte a la agencia. Avisale al admin que revise la invitación.");
      setLoading(false);
      return;
    }
    await supabase
      .from("invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invitation.id);

    router.push("/inicio");
    router.refresh();
  }

  async function createAgency(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const slug = `${slugify(agencyName)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: agency, error: agencyError } = await supabase
      .from("agencies")
      .insert({ name: agencyName.trim(), slug, created_by: userId })
      .select("id")
      .single();

    if (agencyError || !agency) {
      setError("No pudimos crear la agencia. Probá de nuevo.");
      setLoading(false);
      return;
    }

    const { error: memberError } = await supabase.from("members").insert({
      agency_id: agency.id,
      user_id: userId,
      role: "admin",
      display_name: displayName.trim() || fullName,
    });

    if (memberError) {
      setError("La agencia se creó pero no pudimos sumarte. Probá recargar.");
      setLoading(false);
      return;
    }

    router.push("/inicio");
    router.refresh();
  }

  if (invitation) {
    return (
      <div className="card space-y-4 p-6 text-center">
        <p className="text-3xl">🎉</p>
        <div>
          <p className="font-display text-xl font-semibold text-ink">
            Te invitaron a {invitation.agencyName}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            Vas a entrar como{" "}
            <span className="font-medium">
              {invitation.role === "admin"
                ? "Socio/Admin"
                : invitation.role === "vendedor"
                  ? "Vendedor"
                  : "Freelance"}
            </span>
            .
          </p>
        </div>
        {error && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>
        )}
        <Button size="lg" className="w-full" loading={loading} onClick={acceptInvitation}>
          Unirme a la agencia
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={createAgency} className="card space-y-4 p-6">
      <div>
        <p className="font-display text-xl font-semibold text-ink">Creá tu agencia</p>
        <p className="mt-1 text-sm text-ink-soft">
          Un solo paso y ya estás adentro. Después invitás a tu equipo desde Configuración.
        </p>
      </div>
      <div>
        <Label htmlFor="agency">Nombre de la agencia</Label>
        <Input
          id="agency"
          placeholder="Sumaj Viajes"
          value={agencyName}
          onChange={(e) => setAgencyName(e.target.value)}
          required
          autoFocus
        />
      </div>
      <div>
        <Label htmlFor="display">¿Cómo te llaman? (aparece en el CRM)</Label>
        <Input
          id="display"
          placeholder="Tomás"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
      </div>
      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        Crear y empezar
      </Button>
    </form>
  );
}
