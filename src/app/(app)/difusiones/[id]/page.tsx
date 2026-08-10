import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PencilLine } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { parseTemplateButtons } from "@/components/config/template-dialog";
import { BroadcastStatusChip } from "@/components/difusiones/broadcast-card";
import { Results, type BroadcastSummary, type BroadcastTotals } from "@/components/difusiones/results";
import {
  RecipientsList,
  type BroadcastRecipientRow,
} from "@/components/difusiones/recipients-list";
import { fmtDate, fmtDateFull, fmtNumber } from "@/lib/format";

export const metadata = { title: "Difusión" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TOTALS_VACIOS: BroadcastTotals = {
  total: 0,
  pendientes: 0,
  omitidos: 0,
  fallidos: 0,
  enviados: 0,
  entregados: 0,
  leidos: 0,
  respondidos: 0,
  interesados: 0,
  talVez: 0,
  bajas: 0,
  leads: 0,
  ventas: 0,
  ventaTotal: 0,
};

export default async function DifusionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const { isAdmin } = await requireMember();
  const supabase = await createClient();

  const [broadcastRes, totalsRes, recipientsRes, muestraRes] = await Promise.all([
    supabase
      .from("broadcasts")
      .select(
        `id, name, status, scheduled_at, started_at, finished_at, created_at, throttle_per_run,
         total_recipients, body_snapshot, header_snapshot, footer_snapshot, buttons_snapshot,
         template_name_snapshot,
         branch:branches(name),
         creator:members(display_name)`,
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("broadcast_totals").select("*").eq("broadcast_id", id).maybeSingle(),
    // Solo los que reaccionaron o los que no llegaron: el resto no se trabaja.
    supabase
      .from("broadcast_recipients")
      .select(
        `id, contact_id, phone, status, intent, button_label, reply_text, replied_at,
         conversation_id, lead_id, error_detail, contact:contacts(full_name)`,
      )
      .eq("broadcast_id", id)
      .or("replied_at.not.is.null,status.eq.fallido")
      .order("replied_at", { ascending: false, nullsFirst: false })
      .limit(300),
    /* Un destinatario cualquiera, solo por sus `vars`: es lo que convierte la
       burbuja de "Lo que recibieron" en el mensaje de verdad y no en el texto
       con las llaves crudas. */
    supabase
      .from("broadcast_recipients")
      .select("vars")
      .eq("broadcast_id", id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const raw = broadcastRes.data;
  if (!raw) notFound();

  const t = totalsRes.data;
  const totals: BroadcastTotals = t
    ? {
        total: t.total ?? 0,
        pendientes: t.pendientes ?? 0,
        omitidos: t.omitidos ?? 0,
        fallidos: t.fallidos ?? 0,
        enviados: t.enviados ?? 0,
        entregados: t.entregados ?? 0,
        leidos: t.leidos ?? 0,
        respondidos: t.respondidos ?? 0,
        interesados: t.interesados ?? 0,
        talVez: t.tal_vez ?? 0,
        bajas: t.bajas ?? 0,
        leads: t.leads ?? 0,
        ventas: t.ventas ?? 0,
        ventaTotal: Number(t.venta_total ?? 0),
      }
    : TOTALS_VACIOS;

  const recipients: BroadcastRecipientRow[] = (recipientsRes.data ?? []).map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    name: r.contact?.full_name ?? "Sin nombre",
    phone: r.phone,
    status: r.status,
    intent: r.intent,
    buttonLabel: r.button_label,
    replyText: r.reply_text,
    repliedAt: r.replied_at,
    conversationId: r.conversation_id,
    leadId: r.lead_id,
    errorDetail: r.error_detail,
  }));

  /* `broadcast_totals.venta_total` suma sin mirar la moneda: para mostrarla sin
     mentir se busca con qué moneda se vendió de verdad. Con una sola moneda —el
     caso real de cualquier agencia— esto acierta siempre. */
  const currency = await resolveCurrency(
    supabase,
    recipients.map((r) => r.leadId).filter((v): v is string => Boolean(v)),
  );

  const summary: BroadcastSummary = {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    scheduledAt: raw.scheduled_at,
    startedAt: raw.started_at,
    finishedAt: raw.finished_at,
    throttlePerRun: raw.throttle_per_run,
    header: raw.header_snapshot,
    body: raw.body_snapshot,
    footer: raw.footer_snapshot,
    buttons: parseTemplateButtons(raw.buttons_snapshot),
    vars: varsDeMuestra(muestraRes.data?.vars),
    branchName: raw.branch?.name ?? null,
    templateName: raw.template_name_snapshot,
  };

  const esBorrador = raw.status === "borrador";
  const puedeFrenar = isAdmin && (raw.status === "programada" || raw.status === "enviando");

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <Link
          href="/difusiones"
          className="inline-flex min-h-8 items-center gap-1.5 text-sm text-ink-faint transition-colors hover:text-ink tap-highlight-none"
        >
          <ArrowLeft className="size-4" /> Difusiones
        </Link>
      </div>

      <PageHeader
        title={raw.name}
        subtitle={subtitulo(raw.created_at, raw.creator?.display_name ?? null, totals.total)}
        className="pt-3 md:pt-4"
        actions={
          esBorrador && isAdmin ? (
            <Link href={`/difusiones/nueva?id=${raw.id}`}>
              <Button variant="brand">
                <PencilLine />
                Seguir armando
              </Button>
            </Link>
          ) : (
            <BroadcastStatusChip status={raw.status} />
          )
        }
      />

      <div className="space-y-5 px-4 pb-4 md:px-6">
        {esBorrador ? (
          <div className="card p-5">
            <p className="text-sm font-medium text-ink">Todavía no salió</p>
            <p className="mt-1 text-[13px] text-ink-soft">
              Es un borrador: nadie la recibió. Terminá de armarla y disparala cuando quieras.
              {raw.scheduled_at ? ` Estaba pensada para el ${fmtDate(raw.scheduled_at)}.` : ""}
            </p>
          </div>
        ) : (
          <Results
            broadcast={summary}
            totals={totals}
            currency={currency}
            canCancel={puedeFrenar}
          />
        )}

        {!esBorrador && (
          <section>
            <h2 className="mb-2 font-display text-lg font-semibold tracking-tight text-ink">
              Quiénes respondieron
            </h2>
            <RecipientsList rows={recipients} />
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * Las variables congeladas de un destinatario, saneadas.
 *
 * Es jsonb: puede venir cualquier cosa. Lo que no sea texto se descarta y esa
 * variable queda resaltada en la burbuja, que es la verdad.
 */
function varsDeMuestra(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof valor === "string" && valor.trim()) out[clave] = valor;
  }
  return out;
}

/** "Armada por Vale el 12/07/2026 · 312 personas" */
function subtitulo(createdAt: string, creator: string | null, total: number): string {
  const quien = creator ? `Armada por ${creator}` : "Armada";
  const cuando = `el ${fmtDateFull(createdAt)}`;
  const gente = total > 0 ? ` · ${fmtNumber(total)} ${total === 1 ? "persona" : "personas"}` : "";
  return `${quien} ${cuando}${gente}`;
}

/**
 * Moneda con la que se cerraron las ventas de esta difusión. Sin ventas o sin
 * files, USD: es el default de todo el sistema.
 */
async function resolveCurrency(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leadIds: string[],
): Promise<string> {
  const unicos = [...new Set(leadIds)];
  if (unicos.length === 0) return "USD";
  const { data } = await supabase.from("files").select("currency").in("lead_id", unicos);
  if (!data || data.length === 0) return "USD";
  const usos = new Map<string, number>();
  for (const f of data) usos.set(f.currency, (usos.get(f.currency) ?? 0) + 1);
  return [...usos.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
