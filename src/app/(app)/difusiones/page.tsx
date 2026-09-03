import Link from "next/link";
import { redirect } from "next/navigation";
import { Megaphone, Plus } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { BroadcastCard, type BroadcastListRow } from "@/components/difusiones/broadcast-card";
import { fmtNumber } from "@/lib/format";

export const metadata = { title: "Difusiones" };

export default async function DifusionesPage() {
  const { agency, isAdmin, isStaff } = await requireMember();
  /* Las difusiones son de la agencia (salen por el número madre y las arma un
     admin); el freelance no las tiene en el menú y por URL tampoco entra. */
  if (!isStaff) redirect("/inicio");
  const supabase = await createClient();

  const { data: broadcasts } = await supabase
    .from("broadcasts")
    .select("id, name, status, scheduled_at, finished_at, created_at, total_recipients")
    .eq("agency_id", agency.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const lista = broadcasts ?? [];

  /* Los contadores viven en una vista aparte (broadcast_totals) porque el
     estado de cada persona lo mueven tres caminos distintos. Se traen de una y
     se cruzan por id: una difusión sin destinatarios no aparece ahí. */
  const totales = new Map<string, { total: number; enviados: number; respondidos: number; interesados: number; leads: number }>();
  if (lista.length > 0) {
    const { data } = await supabase
      .from("broadcast_totals")
      .select("broadcast_id, total, enviados, respondidos, interesados, leads")
      .in(
        "broadcast_id",
        lista.map((b) => b.id),
      );
    for (const t of data ?? []) {
      if (!t.broadcast_id) continue;
      totales.set(t.broadcast_id, {
        total: t.total ?? 0,
        enviados: t.enviados ?? 0,
        respondidos: t.respondidos ?? 0,
        interesados: t.interesados ?? 0,
        leads: t.leads ?? 0,
      });
    }
  }

  const rows: BroadcastListRow[] = lista.map((b) => {
    const t = totales.get(b.id);
    return {
      id: b.id,
      name: b.name,
      status: b.status,
      scheduledAt: b.scheduled_at,
      finishedAt: b.finished_at,
      createdAt: b.created_at,
      totalRecipients: b.total_recipients,
      total: t?.total ?? b.total_recipients,
      enviados: t?.enviados ?? 0,
      respondidos: t?.respondidos ?? 0,
      interesados: t?.interesados ?? 0,
      leads: t?.leads ?? 0,
    };
  });

  const acumulado = rows.reduce(
    (acc, r) => ({
      interesados: acc.interesados + r.interesados,
      leads: acc.leads + r.leads,
      respondidos: acc.respondidos + r.respondidos,
    }),
    { interesados: 0, leads: 0, respondidos: 0 },
  );
  const hayResultados = acumulado.respondidos > 0 || acumulado.leads > 0;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Difusiones"
        subtitle={
          rows.length > 0
            ? `${fmtNumber(rows.length)} ${rows.length === 1 ? "difusión" : "difusiones"} · ${fmtNumber(acumulado.leads)} ${acumulado.leads === 1 ? "lead" : "leads"} generados`
            : "Escribile a muchos desde el número madre y volvé con leads."
        }
        actions={
          isAdmin ? (
            <Link href="/difusiones/nueva">
              <Button variant="brand">
                <Plus />
                <span className="hidden sm:inline">Nueva difusión</span>
                <span className="sm:hidden">Nueva</span>
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-4 px-4 md:px-6">
        {rows.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="Todavía no difundiste nada"
            description={
              isAdmin
                ? "Elegí a quiénes les hablás, armá el mensaje con botones y mirá cuántos vuelven interesados."
                : "Cuando la agencia mande una, vas a ver acá quiénes respondieron."
            }
            action={
              isAdmin ? (
                <Link href="/difusiones/nueva">
                  <Button variant="brand">
                    <Plus />
                    Armar la primera
                  </Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            {hayResultados && (
              <div className="grid grid-cols-3 gap-2.5 md:gap-3">
                <TotalTile label="Interesados" value={acumulado.interesados} highlight />
                <TotalTile label="Leads" value={acumulado.leads} />
                <TotalTile label="Respuestas" value={acumulado.respondidos} />
              </div>
            )}

            <div className="space-y-2.5 stagger-children">
              {rows.map((row) => (
                <BroadcastCard key={row.id} row={row} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TotalTile({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight && value > 0
          ? "card min-w-0 border-brand-tint-line bg-brand-tint p-3.5 md:p-4"
          : "card min-w-0 p-3.5 md:p-4"
      }
    >
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      <p
        className={
          highlight && value > 0
            ? "mt-1 text-xl font-semibold tabular-nums text-brand-text md:text-2xl"
            : "mt-1 text-xl font-semibold tabular-nums text-ink md:text-2xl"
        }
      >
        {fmtNumber(value)}
      </p>
    </div>
  );
}
