"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, PartyPopper } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { MemberRole } from "@/lib/types";

type Invitation = {
  id: string;
  agencyId: string;
  agencyName: string;
  role: MemberRole;
  displayName: string | null;
  commissionPct: number;
};

const ROLE_META: Record<MemberRole, { label: string; chip: string; dot: string }> = {
  admin: {
    label: "Socio/Admin",
    chip: "bg-brand-tint text-brand-text border-brand-tint-line",
    dot: "bg-brand-500",
  },
  vendedor: {
    label: "Vendedor",
    chip: "bg-tone-sky-soft text-tone-sky-text border-tone-sky-line",
    dot: "bg-sky-500",
  },
  freelance: {
    label: "Freelance",
    chip: "bg-tone-violet-soft text-tone-violet-text border-tone-violet-line",
    dot: "bg-violet-500",
  },
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

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-tone-red-line bg-tone-red-soft px-3 py-2.5 text-left text-[13px] text-tone-red-text animate-scale-in">
      <CircleAlert className="mt-px size-4 shrink-0" strokeWidth={1.75} />
      {children}
    </p>
  );
}

export function OnboardingForm({
  userId,
  email,
  fullName,
  invitation,
}: {
  userId: string;
  /** el de la cuenta, ya normalizado en el server */
  email: string | null;
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
      email,
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
      email,
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
    const roleMeta = ROLE_META[invitation.role] ?? ROLE_META.vendedor;
    return (
      <div className="card flex flex-col items-center gap-4 p-6 text-center sm:p-8">
        <div className="flex size-16 items-center justify-center rounded-full bg-brand-tint text-brand-text ring-4 ring-brand-tint/40 animate-pop">
          <PartyPopper className="size-7" strokeWidth={1.75} />
        </div>
        <div>
          <p className="font-display text-[22px] font-semibold leading-tight tracking-tight text-ink">
            Te invitaron a {invitation.agencyName}
          </p>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-ink-soft">
            Vas a entrar como
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium leading-4",
                roleMeta.chip,
              )}
            >
              <span className={cn("size-1.5 rounded-full", roleMeta.dot)} aria-hidden />
              {roleMeta.label}
            </span>
          </p>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button size="lg" className="w-full" loading={loading} onClick={acceptInvitation}>
          Unirme a la agencia
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={createAgency} className="card space-y-4 p-6 sm:p-8">
      <div>
        <p className="font-display text-[22px] font-semibold leading-tight tracking-tight text-ink">
          Creá tu agencia
        </p>
        <p className="mt-1.5 text-sm text-ink-soft">
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
          className="h-11"
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
          className="h-11"
        />
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        Crear y empezar
      </Button>
    </form>
  );
}
