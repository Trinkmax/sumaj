import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ContactHeader } from "@/components/clientes/contact-header";
import { DatosCard } from "@/components/clientes/datos-card";
import { TravelersCard } from "@/components/clientes/travelers-card";
import { HistoriaCard } from "@/components/clientes/historia-card";
import { ActivityTimeline } from "@/components/clientes/activity-timeline";
import type {
  ContactRow,
  FileSummary,
  QuoteSummary,
} from "@/components/clientes/types";

export const metadata = { title: "Cliente" };

export default async function ClienteDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireMember();
  const supabase = await createClient();

  const [contactRes, travelersRes, leadsRes, filesRes, activitiesRes, tagsRes] =
    await Promise.all([
      supabase
        .from("contacts")
        .select("*, contact_tags(tag:tags(*))")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("travelers")
        .select("*")
        .eq("contact_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("leads")
        .select("id, stage, destination, created_at, won_file_id")
        .eq("contact_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("files")
        .select("id, code, destination, status, currency, created_at")
        .eq("contact_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("activities")
        .select("*, member:members(display_name)")
        .eq("contact_id", id)
        .order("created_at", { ascending: false })
        .limit(60),
      supabase.from("tags").select("*").order("name"),
    ]);

  if (!contactRes.data) notFound();

  const { contact_tags, ...contactRest } = contactRes.data;
  const contact: ContactRow = {
    ...contactRest,
    tags: (contact_tags ?? [])
      .map((ct) => ct.tag)
      .filter((t): t is NonNullable<typeof t> => t != null),
  };

  const leads = leadsRes.data ?? [];
  const rawFiles = filesRes.data ?? [];

  // totales de las ventas (vista file_totals)
  const fileIds = rawFiles.map((f) => f.id);
  const { data: totals } = fileIds.length
    ? await supabase.from("file_totals").select("file_id, total_sale").in("file_id", fileIds)
    : { data: [] as { file_id: string | null; total_sale: number | null }[] };

  const totalByFile = new Map(
    (totals ?? []).map((t) => [t.file_id as string, Number(t.total_sale) || 0]),
  );
  const files: FileSummary[] = rawFiles.map((f) => ({
    ...f,
    total_sale: totalByFile.get(f.id) ?? 0,
  }));

  // presupuestos: del contacto directo o de sus consultas
  const leadIds = leads.map((l) => l.id);
  const orFilter =
    leadIds.length > 0
      ? `contact_id.eq.${id},lead_id.in.(${leadIds.join(",")})`
      : `contact_id.eq.${id}`;
  const { data: quotesData } = await supabase
    .from("quotes")
    .select("id, code, status, total_price, currency, destination, created_at")
    .or(orFilter)
    .order("created_at", { ascending: false });
  const quotes: QuoteSummary[] = quotesData ?? [];

  // lead activo más reciente (para "Presupuestar")
  const activeLead =
    leads.find((l) => l.stage !== "ganado" && l.stage !== "perdido") ?? null;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <Link
          href="/clientes"
          className="inline-flex min-h-8 items-center gap-1.5 text-sm text-ink-faint transition-colors hover:text-ink tap-highlight-none"
        >
          <ArrowLeft className="size-4" /> Clientes
        </Link>
      </div>

      <ContactHeader
        contact={contact}
        allTags={tagsRes.data ?? []}
        activeLeadId={activeLead?.id ?? null}
      />

      <div className="grid gap-4 px-4 pt-4 md:px-6 lg:grid-cols-[2fr_3fr] lg:items-start">
        <div className="space-y-4">
          <DatosCard contact={contact} />
          <TravelersCard contactId={contact.id} travelers={travelersRes.data ?? []} />
        </div>

        <div className="space-y-4">
          <HistoriaCard leads={leads} files={files} quotes={quotes} />
          <ActivityTimeline contactId={contact.id} activities={activitiesRes.data ?? []} />
        </div>
      </div>
    </div>
  );
}
