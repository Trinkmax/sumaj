"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plane } from "lucide-react";
import { TRIP_TYPES } from "@/lib/domain";
import { fmtDate, fmtMoney, nightsBetween } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { updateLeadDetails } from "@/lib/actions/leads";
import type { TripType } from "@/lib/types";
import type { DetailLead } from "./types";

export function TripDetailsCard({ lead }: { lead: DetailLead }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [destination, setDestination] = React.useState(lead.destination ?? "");
  const [from, setFrom] = React.useState(lead.trip_date_from ?? "");
  const [to, setTo] = React.useState(lead.trip_date_to ?? "");
  const [adults, setAdults] = React.useState(String(lead.pax_adults));
  const [children, setChildren] = React.useState(String(lead.pax_children));
  const [tripType, setTripType] = React.useState<string>(lead.trip_type ?? "");
  const [budget, setBudget] = React.useState(
    lead.budget_estimate != null ? String(lead.budget_estimate) : "",
  );
  const [currency, setCurrency] = React.useState(lead.budget_currency || "USD");

  function openDialog() {
    setDestination(lead.destination ?? "");
    setFrom(lead.trip_date_from ?? "");
    setTo(lead.trip_date_to ?? "");
    setAdults(String(lead.pax_adults));
    setChildren(String(lead.pax_children));
    setTripType(lead.trip_type ?? "");
    setBudget(lead.budget_estimate != null ? String(lead.budget_estimate) : "");
    setCurrency(lead.budget_currency || "USD");
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await updateLeadDetails({
      leadId: lead.id,
      destination: destination.trim() || null,
      tripDateFrom: from || null,
      tripDateTo: to || null,
      paxAdults: Math.max(0, parseInt(adults, 10) || 0),
      paxChildren: Math.max(0, parseInt(children, 10) || 0),
      tripType: (tripType || null) as TripType | null,
      budgetEstimate: budget.trim() ? Number(budget) : null,
      budgetCurrency: currency === "ARS" ? "ARS" : "USD",
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Datos del viaje guardados ✈️");
    setOpen(false);
    router.refresh();
  }

  const nights = nightsBetween(lead.trip_date_from, lead.trip_date_to);
  const paxLabel =
    `${lead.pax_adults} ${lead.pax_adults === 1 ? "adulto" : "adultos"}` +
    (lead.pax_children > 0
      ? ` · ${lead.pax_children} ${lead.pax_children === 1 ? "menor" : "menores"}`
      : "");

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Plane className="size-4 text-brand-600" />
          Datos del viaje
        </h2>
        <Button variant="ghost" size="sm" onClick={openDialog}>
          <Pencil />
          Editar
        </Button>
      </div>

      <dl className="space-y-2.5 text-sm">
        <Row label="Destino" value={lead.destination ? `✈️ ${lead.destination}` : null} />
        <Row
          label="Fechas"
          value={
            lead.trip_date_from
              ? `${fmtDate(lead.trip_date_from)}${
                  lead.trip_date_to ? ` — ${fmtDate(lead.trip_date_to)}` : ""
                }${nights ? ` · ${nights} noches` : ""}`
              : null
          }
        />
        <Row label="Pasajeros" value={paxLabel} />
        <Row label="Tipo de viaje" value={lead.trip_type ? TRIP_TYPES[lead.trip_type] : null} />
        <Row
          label="Presupuesto est."
          value={
            lead.budget_estimate != null
              ? fmtMoney(lead.budget_estimate, lead.budget_currency)
              : null
          }
          money
        />
      </dl>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Editar datos del viaje" size="lg">
          <form onSubmit={save} className="space-y-4">
            <div>
              <Label htmlFor="td-dest">Destino</Label>
              <Input
                id="td-dest"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Ej: Río de Janeiro"
                maxLength={120}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="td-from">Salida (tentativa)</Label>
                <Input
                  id="td-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="td-to">Regreso</Label>
                <Input
                  id="td-to"
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="td-adults">Adultos</Label>
                <Input
                  id="td-adults"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={99}
                  value={adults}
                  onChange={(e) => setAdults(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="td-children">Menores</Label>
                <Input
                  id="td-children"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={99}
                  value={children}
                  onChange={(e) => setChildren(e.target.value)}
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <Label htmlFor="td-type">Tipo de viaje</Label>
                <Select
                  id="td-type"
                  value={tripType}
                  onChange={(e) => setTripType(e.target.value)}
                >
                  <option value="">—</option>
                  {Object.entries(TRIP_TYPES).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_110px] gap-4">
              <div>
                <Label htmlFor="td-budget">Presupuesto estimado</Label>
                <Input
                  id="td-budget"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <Label htmlFor="td-currency">Moneda</Label>
                <Select
                  id="td-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                </Select>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" loading={saving}>
                Guardar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Row({
  label,
  value,
  money,
}: {
  label: string;
  value: string | null;
  money?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[13px] text-ink-faint">{label}</dt>
      <dd
        className={
          value
            ? money
              ? "text-right font-semibold tabular-nums text-money-700"
              : "text-right font-medium text-ink"
            : "text-right text-ink-faint/60"
        }
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}
