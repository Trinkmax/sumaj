"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarDays,
  MapPin,
  Pencil,
  Plane,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TRIP_TYPES } from "@/lib/domain";
import { fmtDate, fmtMoney, nightsBetween } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { ChoiceGrid, Segmented } from "@/components/ui/misc";
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
  const [tripType, setTripType] = React.useState<TripType | null>(lead.trip_type);
  const [budget, setBudget] = React.useState(
    lead.budget_estimate != null ? String(lead.budget_estimate) : "",
  );
  const [currency, setCurrency] = React.useState<"USD" | "ARS">(
    lead.budget_currency === "ARS" ? "ARS" : "USD",
  );

  function openDialog() {
    setDestination(lead.destination ?? "");
    setFrom(lead.trip_date_from ?? "");
    setTo(lead.trip_date_to ?? "");
    setAdults(String(lead.pax_adults));
    setChildren(String(lead.pax_children));
    setTripType(lead.trip_type);
    setBudget(lead.budget_estimate != null ? String(lead.budget_estimate) : "");
    setCurrency(lead.budget_currency === "ARS" ? "ARS" : "USD");
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
      tripType,
      budgetEstimate: budget.trim() ? Number(budget) : null,
      budgetCurrency: currency,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Datos del viaje guardados");
    setOpen(false);
    router.refresh();
  }

  const nights = nightsBetween(lead.trip_date_from, lead.trip_date_to);
  const paxLabel =
    `${lead.pax_adults} ${lead.pax_adults === 1 ? "adulto" : "adultos"}` +
    (lead.pax_children > 0
      ? ` · ${lead.pax_children} ${lead.pax_children === 1 ? "menor" : "menores"}`
      : "");

  const tripMeta = lead.trip_type ? TRIP_TYPES[lead.trip_type] : null;

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Plane className="size-4 text-brand-600" strokeWidth={1.75} />
          Datos del viaje
        </h2>
        <Button variant="ghost" size="sm" onClick={openDialog}>
          <Pencil />
          Editar
        </Button>
      </div>

      <dl className="space-y-2.5 text-sm">
        <Row icon={MapPin} label="Destino" value={lead.destination} />
        <Row
          icon={CalendarDays}
          label="Fechas"
          value={
            lead.trip_date_from
              ? `${fmtDate(lead.trip_date_from)}${
                  lead.trip_date_to ? ` — ${fmtDate(lead.trip_date_to)}` : ""
                }${nights ? ` · ${nights} noches` : ""}`
              : null
          }
        />
        <Row icon={Users} label="Pasajeros" value={paxLabel} />
        <Row
          icon={tripMeta?.icon ?? Users}
          label="Tipo de viaje"
          value={tripMeta?.label ?? null}
        />
        <Row
          icon={Wallet}
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

            <div className="grid grid-cols-2 gap-4">
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
            </div>

            <div>
              <Label>Tipo de viaje</Label>
              <ChoiceGrid<TripType>
                options={(Object.keys(TRIP_TYPES) as TripType[]).map((key) => ({
                  value: key,
                  label: TRIP_TYPES[key].label,
                  icon: TRIP_TYPES[key].icon,
                }))}
                value={tripType}
                onChange={(v) => setTripType(v === tripType ? null : v)}
                columns={3}
                size="sm"
              />
            </div>

            <div className="grid grid-cols-[1fr_auto] items-end gap-4">
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
              <Segmented<"USD" | "ARS">
                value={currency}
                onChange={setCurrency}
                options={[
                  { value: "USD", label: "USD" },
                  { value: "ARS", label: "ARS" },
                ]}
                className="mb-0.5"
              />
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
  icon: Icon,
  label,
  value,
  money,
}: {
  icon: LucideIcon;
  label: string;
  value: string | null;
  money?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="flex shrink-0 items-center gap-1.5 text-[13px] text-ink-faint">
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
        {label}
      </dt>
      <dd
        className={cn(
          "text-right",
          value
            ? money
              ? "font-semibold tabular-nums text-money-700"
              : "font-medium text-ink"
            : "text-ink-faint/60",
        )}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}
