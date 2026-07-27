"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  AlarmClock,
  ArrowRight,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Switch, EmptyState, Tooltip, ChoiceGrid } from "@/components/ui/misc";
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
} from "@/components/ui/dropdown";
import {
  addService,
  updateService,
  deleteService,
  toggleServicePaid,
  updateFileCommission,
} from "@/lib/actions/files";
import {
  COMMISSION_TYPES,
  SERVICE_TYPES,
  SERVICE_ORDER,
  fileCommission,
  round2,
  type CommissionType,
} from "@/lib/domain";
import { fmtDate, fmtDeadline, fmtMoney, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ServiceImage, ServiceType } from "@/lib/types";
import { numToInput, parseAmount } from "./helpers";
import { ServiceImagesField, ServiceImagesStrip } from "./service-images";
import type { ServiceRow, SupplierOption } from "./types";

/** círculo tonal por tipo de servicio (clases estáticas para Tailwind) */
const SERVICE_TONES: Record<ServiceType, string> = {
  aereo: "bg-tone-sky-soft text-tone-sky-text",
  hotel: "bg-tone-violet-soft text-tone-violet-text",
  paquete: "bg-tone-amber-soft text-tone-amber-text",
  circuito: "bg-tone-indigo-soft text-tone-indigo-text",
  crucero: "bg-tone-blue-soft text-tone-blue-text",
  excursion: "bg-tone-green-soft text-tone-green-text",
  traslado: "bg-tone-cyan-soft text-tone-cyan-text",
  asistencia: "bg-tone-emerald-soft text-tone-emerald-text",
  otro: "bg-tone-stone-soft text-tone-stone-text",
};

/** urgencia de la fecha de caída (la calcula fmtDeadline) */
const DEADLINE_TONES: Record<"red" | "amber" | "stone", string> = {
  red: "bg-tone-red-soft text-tone-red-text border-tone-red-line",
  amber: "bg-tone-amber-soft text-tone-amber-text border-tone-amber-line",
  stone: "bg-tone-stone-soft text-tone-stone-text border-tone-stone-line",
};

/** una reserva entra al banner si cae dentro de una semana (o ya venció) */
const DUE_SOON_DAYS = 7;

/** identidad estable para cuando no hay ningún toggle optimista en vuelo */
const NO_OVERRIDES: Record<string, boolean> = {};

type DueItem = {
  service: ServiceRow;
  deadline: NonNullable<ReturnType<typeof fmtDeadline>>;
};

export function ServicesCard({
  fileId,
  agencyId,
  currency,
  services,
  suppliers,
  sellerName,
  commissionType,
  commissionPct,
  commissionAmount,
  commissionLabel,
  isAdmin,
  className,
}: {
  fileId: string;
  agencyId: string;
  currency: string;
  services: ServiceRow[];
  suppliers: SupplierOption[];
  sellerName: string;
  commissionType: string;
  commissionPct: number;
  commissionAmount: number;
  commissionLabel: string | null;
  isAdmin: boolean;
  className?: string;
}) {
  const [dialogService, setDialogService] = React.useState<ServiceRow | "new" | null>(null);
  const [toDelete, setToDelete] = React.useState<ServiceRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [commissionOpen, setCommissionOpen] = React.useState(false);

  /* toggle "pagado a proveedor" optimista: el override vale mientras el servidor
     siga contestando lo mismo; en cuanto llegan datos nuevos se descarta solo. */
  const serverPaid = services.map((s) => `${s.id}:${s.paid_to_supplier ? 1 : 0}`).join("|");
  const [optimistic, setOptimistic] = React.useState<{
    from: string;
    map: Record<string, boolean>;
  }>({ from: serverPaid, map: {} });
  const paidOverrides = optimistic.from === serverPaid ? optimistic.map : NO_OVERRIDES;

  const isPaid = (s: ServiceRow) => paidOverrides[s.id] ?? s.paid_to_supplier;

  const togglePaid = async (s: ServiceRow) => {
    const next = !isPaid(s);
    setOptimistic((prev) => ({
      from: serverPaid,
      map: { ...(prev.from === serverPaid ? prev.map : {}), [s.id]: next },
    }));
    const res = await toggleServicePaid({ serviceId: s.id, fileId, paid: next });
    if (!res.ok) {
      // revertir = soltar el override y volver a lo que dice el servidor
      setOptimistic((prev) => {
        const map = { ...prev.map };
        delete map[s.id];
        return { from: prev.from, map };
      });
      toast.error(res.error);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    const res = await deleteService({ serviceId: toDelete.id, fileId });
    setDeleting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Servicio eliminado");
    setToDelete(null);
  };

  /* agrupado por tipo, en el orden de la planilla */
  const groups = React.useMemo(
    () =>
      SERVICE_ORDER.map((type) => ({
        type,
        items: services.filter((s) => s.type === type),
      })).filter((g) => g.items.length > 0),
    [services],
  );

  /* reservas sin pagar que caen en <= 7 días (o ya vencidas), la más urgente primero */
  const dueSoon = React.useMemo<DueItem[]>(() => {
    const out: DueItem[] = [];
    for (const s of services) {
      if (!s.deadline_date) continue;
      if (paidOverrides[s.id] ?? s.paid_to_supplier) continue;
      const deadline = fmtDeadline(s.deadline_date);
      if (!deadline || deadline.days > DUE_SOON_DAYS) continue;
      out.push({ service: s, deadline });
    }
    return out.sort((a, b) => a.deadline.days - b.deadline.days);
  }, [services, paidOverrides]);

  const totalCost = round2(services.reduce((a, s) => a + s.cost, 0));
  const totalSale = round2(services.reduce((a, s) => a + s.price, 0));
  const utility = round2(totalSale - totalCost);
  const isFixed = commissionType === "monto_fijo";
  const commission = fileCommission({
    commission_type: commissionType,
    commission_pct: commissionPct,
    commission_amount: commissionAmount,
    utility,
  });
  const showCommission = isAdmin || commission > 0;

  return (
    <section className={cn("card animate-slide-up p-4 md:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-ink">Servicios</h2>
        <Button variant="secondary" size="sm" onClick={() => setDialogService("new")}>
          <Plus /> Agregar
        </Button>
      </div>

      {dueSoon.length > 0 && (
        <DeadlineBanner items={dueSoon} onOpen={(s) => setDialogService(s)} />
      )}

      {services.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="Sin servicios cargados"
          description="Agregá el aéreo, la hotelería y todo lo que vendiste en este file."
          action={
            <Button size="sm" onClick={() => setDialogService("new")}>
              <Plus /> Agregar servicio
            </Button>
          }
        />
      ) : (
        <>
          <div className="space-y-4 stagger-children">
            {groups.map((g) => {
              const meta = SERVICE_TYPES[g.type];
              const GroupIcon = meta.icon;
              const groupSale = round2(g.items.reduce((a, s) => a + s.price, 0));
              return (
                <div key={g.type}>
                  {/* header del grupo */}
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full",
                        SERVICE_TONES[g.type],
                      )}
                    >
                      <GroupIcon className="size-4" strokeWidth={1.9} />
                    </span>
                    <h3 className="text-[13px] font-semibold text-ink">
                      {g.items.length === 1 ? meta.label : meta.plural}
                    </h3>
                    {g.items.length > 1 && (
                      <span className="rounded-full bg-sand-soft px-1.5 text-[11px] font-medium tabular-nums text-ink-faint">
                        {g.items.length}
                      </span>
                    )}
                    <span className="ml-auto text-xs font-medium tabular-nums text-ink-soft">
                      {fmtMoney(groupSale, currency)}
                    </span>
                  </div>

                  {/* servicios del grupo */}
                  <div className="mt-0.5 divide-y divide-line/70 pl-[42px]">
                    {g.items.map((s) => (
                      <ServiceItem
                        key={s.id}
                        service={s}
                        currency={currency}
                        paid={isPaid(s)}
                        onTogglePaid={() => togglePaid(s)}
                        onEdit={() => setDialogService(s)}
                        onDelete={() => setToDelete(s)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* totales — costo / venta / utilidad alineados tabular */}
          <div className="mt-4 space-y-1.5 rounded-xl bg-sand-soft/60 p-3.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-soft">Costo total</span>
              <span className="font-medium tabular-nums text-ink-soft">
                {fmtMoney(totalCost, currency)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-soft">Venta total</span>
              <span className="font-semibold tabular-nums text-ink">
                {fmtMoney(totalSale, currency)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-line pt-1.5">
              <span className="text-sm font-semibold text-ink">Utilidad</span>
              <span className="text-lg font-bold tabular-nums text-money-text">
                {fmtMoney(utility, currency)}
              </span>
            </div>

            {showCommission && (
              <CommissionLine
                sellerName={sellerName}
                currency={currency}
                isFixed={isFixed}
                commissionPct={commissionPct}
                commissionLabel={commissionLabel}
                commission={commission}
                editable={isAdmin}
                onEdit={() => setCommissionOpen(true)}
              />
            )}
          </div>
        </>
      )}

      {dialogService && (
        <ServiceDialog
          key={dialogService === "new" ? "new" : dialogService.id}
          fileId={fileId}
          agencyId={agencyId}
          currency={currency}
          suppliers={suppliers}
          service={dialogService === "new" ? null : dialogService}
          open
          onOpenChange={(o) => !o && setDialogService(null)}
        />
      )}

      {commissionOpen && (
        <CommissionDialog
          fileId={fileId}
          currency={currency}
          sellerName={sellerName}
          utility={utility}
          commissionType={commissionType}
          commissionPct={commissionPct}
          commissionAmount={commissionAmount}
          commissionLabel={commissionLabel}
          open
          onOpenChange={setCommissionOpen}
        />
      )}

      {toDelete && (
        <Dialog open onOpenChange={(o) => !o && setToDelete(null)}>
          <DialogContent
            title="Eliminar servicio"
            description={`¿Seguro que querés eliminar "${toDelete.description}"? No se puede deshacer.`}
          >
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setToDelete(null)}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={confirmDelete} loading={deleting}>
                <Trash2 /> Eliminar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

/* ───────────────────────── caída de reservas ───────────────────────── */

/** chip de la fecha de caída. `muted` = ya está pagada al proveedor: informa, no alarma. */
function DeadlineChip({
  date,
  muted,
  className,
}: {
  date: string;
  muted?: boolean;
  className?: string;
}) {
  const dl = fmtDeadline(date);
  if (!dl) return null;
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium",
        muted ? "border-line bg-sand-soft text-ink-faint" : DEADLINE_TONES[dl.tone],
        className,
      )}
    >
      <AlarmClock className="size-3.5 shrink-0" strokeWidth={1.9} />
      {muted ? `Caía ${fmtDate(date)}` : dl.label}
    </span>
  );
}

/** aviso compacto arriba de la lista: cuántas reservas caen y cuál es la más urgente */
function DeadlineBanner({
  items,
  onOpen,
}: {
  items: DueItem[];
  onOpen: (service: ServiceRow) => void;
}) {
  const first = items[0];
  const overdue = items.filter((i) => i.deadline.days < 0).length;
  const title =
    items.length === 1
      ? first.deadline.days < 0
        ? "Reserva vencida"
        : "Reserva por caer"
      : overdue === items.length
        ? `${items.length} reservas vencidas`
        : `${items.length} reservas por caer`;

  return (
    <button
      type="button"
      onClick={() => onOpen(first.service)}
      className={cn(
        "mb-3 flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-transform tap-highlight-none active:scale-[0.99] animate-fade-in",
        DEADLINE_TONES[first.deadline.tone],
      )}
    >
      <AlarmClock className="size-4.5 shrink-0" strokeWidth={1.9} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-snug">{title}</p>
        <p className="truncate text-xs leading-snug opacity-90">
          {first.service.description} — {first.deadline.label}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 opacity-60" strokeWidth={2} />
    </button>
  );
}

/* ───────────────────────── fila de servicio ───────────────────────── */

function ServiceItem({
  service: s,
  currency,
  paid,
  onTogglePaid,
  onEdit,
  onDelete,
}: {
  service: ServiceRow;
  currency: string;
  paid: boolean;
  onTogglePaid: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-ink">{s.description}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-faint">
            {s.supplier_name && <span className="truncate">{s.supplier_name}</span>}
            {s.reservation_code && (
              <span className="font-mono font-medium text-ink-soft">{s.reservation_code}</span>
            )}
            {s.date_from && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                {fmtDate(s.date_from)}
                {s.date_to && (
                  <>
                    <ArrowRight className="size-3" strokeWidth={2} />
                    {fmtDate(s.date_to)}
                  </>
                )}
              </span>
            )}
          </p>
        </div>

        <div className="shrink-0 text-right tabular-nums">
          <p className="text-sm font-semibold text-ink">{fmtMoney(s.price, currency)}</p>
          <p className="text-xs text-ink-faint">costo {fmtMoney(s.cost, currency)}</p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {/* switch de pagado: visible directo en desktop */}
          <Tooltip content={paid ? "Pagado al proveedor" : "Debe al proveedor"}>
            <span className="hidden md:inline-flex">
              <Switch
                checked={paid}
                onCheckedChange={onTogglePaid}
                aria-label={`Pagado al proveedor: ${s.description}`}
              />
            </span>
          </Tooltip>
          <Dropdown>
            <DropdownTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="-mr-1"
                aria-label="Opciones del servicio"
              >
                <MoreHorizontal />
              </Button>
            </DropdownTrigger>
            <DropdownContent align="end">
              <DropdownItem onSelect={onEdit}>
                <Pencil /> Editar
              </DropdownItem>
              <DropdownItem destructive onSelect={onDelete}>
                <Trash2 /> Eliminar
              </DropdownItem>
            </DropdownContent>
          </Dropdown>
        </div>
      </div>

      {/* pie de la fila: pago al proveedor (mobile), caída de la reserva y vouchers.
          Sin caída ni fotos no aporta nada en desktop (ahí el switch ya está arriba). */}
      <div
        className={cn(
          "mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5",
          !s.deadline_date && s.images.length === 0 && "md:hidden",
        )}
      >
        <label className="flex min-h-6 items-center gap-2 text-xs text-ink-faint tap-highlight-none md:hidden">
          <Switch checked={paid} onCheckedChange={onTogglePaid} />
          {paid ? "Pagado a proveedor" : "Debe al proveedor"}
        </label>
        {s.deadline_date && <DeadlineChip date={s.deadline_date} muted={paid} />}
        <ServiceImagesStrip images={s.images} />
      </div>
    </div>
  );
}

/* ───────────────────────── comisión del vendedor ───────────────────────── */

function CommissionLine({
  sellerName,
  currency,
  isFixed,
  commissionPct,
  commissionLabel,
  commission,
  editable,
  onEdit,
}: {
  sellerName: string;
  currency: string;
  isFixed: boolean;
  commissionPct: number;
  commissionLabel: string | null;
  commission: number;
  editable: boolean;
  onEdit: () => void;
}) {
  const content = (
    <>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] text-ink-faint">
        <span className="truncate">
          Comisión {sellerName}
          {!isFixed && commissionPct > 0
            ? ` (${fmtNumber(commissionPct, Number.isInteger(commissionPct) ? 0 : 1)}%)`
            : ""}
        </span>
        {commissionLabel && (
          <span className="rounded-full border border-brand-tint-line bg-brand-tint px-1.5 py-0.5 text-[10px] font-medium leading-tight text-brand-text">
            {commissionLabel}
          </span>
        )}
        {isFixed && !commissionLabel && (
          <span className="rounded-full border border-line bg-paper px-1.5 py-0.5 text-[10px] font-medium leading-tight text-ink-faint">
            {COMMISSION_TYPES.monto_fijo.short}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="text-[13px] font-medium tabular-nums text-ink-soft">
          {fmtMoney(commission, currency)}
        </span>
        {editable && <Pencil className="size-3.5 text-ink-faint" strokeWidth={2} />}
      </span>
    </>
  );

  if (!editable) {
    return <div className="flex items-center justify-between gap-2 pt-0.5">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label="Editar la comisión del vendedor"
      className="-mx-1.5 flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-1.5 text-left transition-colors hover:bg-sand-deep/50 tap-highlight-none"
    >
      {content}
    </button>
  );
}

const COMMISSION_ORDER: CommissionType[] = ["utilidad_pct", "monto_fijo"];

function CommissionDialog({
  fileId,
  currency,
  sellerName,
  utility,
  commissionType,
  commissionPct,
  commissionAmount,
  commissionLabel,
  open,
  onOpenChange,
}: {
  fileId: string;
  currency: string;
  sellerName: string;
  utility: number;
  commissionType: string;
  commissionPct: number;
  commissionAmount: number;
  commissionLabel: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [type, setType] = React.useState<CommissionType>(
    commissionType === "monto_fijo" ? "monto_fijo" : "utilidad_pct",
  );
  const [pct, setPct] = React.useState(numToInput(commissionPct));
  const [amount, setAmount] = React.useState(numToInput(commissionAmount));
  const [label, setLabel] = React.useState(commissionLabel ?? "");
  const [loading, setLoading] = React.useState(false);

  const pctNum = parseAmount(pct);
  const amountNum = parseAmount(amount);
  const preview = fileCommission({
    commission_type: type,
    commission_pct: pctNum,
    commission_amount: amountNum,
    utility,
  });

  const submit = async () => {
    if (type === "utilidad_pct" && (pctNum < 0 || pctNum > 100)) {
      toast.error("El porcentaje va de 0 a 100.");
      return;
    }
    if (type === "monto_fijo" && amountNum < 0) {
      toast.error("El monto no puede ser negativo.");
      return;
    }
    setLoading(true);
    const res = await updateFileCommission({
      fileId,
      commissionType: type,
      commissionPct: Math.min(100, Math.max(0, pctNum)),
      commissionAmount: Math.max(0, amountNum),
      commissionLabel: label.trim() || null,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Listo, actualizamos la comisión");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Comisión del vendedor"
        description={`Cómo cobra ${sellerName} esta venta.`}
      >
        <div className="space-y-4">
          <ChoiceGrid<CommissionType>
            options={COMMISSION_ORDER.map((k) => ({
              value: k,
              label: COMMISSION_TYPES[k].label,
              icon: COMMISSION_TYPES[k].icon,
              hint: COMMISSION_TYPES[k].hint,
            }))}
            value={type}
            onChange={setType}
            columns={2}
          />

          {type === "utilidad_pct" ? (
            <div>
              <Label htmlFor="cm-pct">Porcentaje de la utilidad</Label>
              <div className="relative">
                <Input
                  id="cm-pct"
                  inputMode="decimal"
                  value={pct}
                  onChange={(e) => setPct(e.target.value)}
                  placeholder="0"
                  className="pr-8 text-right tabular-nums"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-ink-faint">
                  %
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-faint">
                Utilidad de este file: {fmtMoney(utility, currency)}
              </p>
            </div>
          ) : (
            <div>
              <Label htmlFor="cm-amount">Monto por venta</Label>
              <div className="relative">
                <Input
                  id="cm-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="pr-12 text-right tabular-nums"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-ink-faint">
                  {currency}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-faint">
                Se paga igual, sin importar la utilidad del file.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="cm-label">Etiqueta (opcional)</Label>
            <Input
              id="cm-label"
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ej: Grupal Europa"
            />
            <p className="mt-1.5 text-[11px] text-ink-faint">
              Queda al lado de la comisión, para acordarte por qué es así.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl bg-money-tint px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-money-text">Cobra {sellerName}</p>
              <p className="text-[11px] text-ink-faint">con esta venta</p>
            </div>
            <span className="shrink-0 text-xl font-bold tabular-nums text-money-text">
              {fmtMoney(preview, currency)}
            </span>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={loading}>
              Guardar comisión
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── alta / edición ───────────────────────── */

function ServiceDialog({
  fileId,
  agencyId,
  currency,
  suppliers,
  service,
  open,
  onOpenChange,
}: {
  fileId: string;
  agencyId: string;
  currency: string;
  suppliers: SupplierOption[];
  service: ServiceRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const isEdit = !!service;
  const [type, setType] = React.useState<ServiceType>(service?.type ?? "aereo");
  const [description, setDescription] = React.useState(service?.description ?? "");
  const [supplierId, setSupplierId] = React.useState(service?.supplier_id ?? "");
  const [reservationCode, setReservationCode] = React.useState(service?.reservation_code ?? "");
  const [dateFrom, setDateFrom] = React.useState(service?.date_from ?? "");
  const [dateTo, setDateTo] = React.useState(service?.date_to ?? "");
  const [deadlineDate, setDeadlineDate] = React.useState(service?.deadline_date ?? "");
  const [images, setImages] = React.useState<ServiceImage[]>(service?.images ?? []);
  const [uploadingImages, setUploadingImages] = React.useState(false);
  const [cost, setCost] = React.useState(numToInput(service?.cost));
  const [price, setPrice] = React.useState(numToInput(service?.price));
  const [loading, setLoading] = React.useState(false);

  const costNum = parseAmount(cost);
  const priceNum = parseAmount(price);
  const utility = round2(priceNum - costNum);
  const canSave = description.trim().length > 0 && !uploadingImages;

  const submit = async () => {
    if (!canSave) return;
    setLoading(true);
    const payload = {
      fileId,
      type,
      description: description.trim(),
      supplierId: supplierId || null,
      reservationCode: reservationCode.trim() || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      deadlineDate: deadlineDate || null,
      images,
      cost: costNum,
      price: priceNum,
    };
    const res = service
      ? await updateService({ serviceId: service.id, ...payload })
      : await addService(payload);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(isEdit ? "Servicio actualizado" : "Servicio agregado");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? "Editar servicio" : "Agregar servicio"}
        description="Costo y precio en la moneda del file."
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <Label>Tipo de servicio</Label>
            <ChoiceGrid<ServiceType>
              options={SERVICE_ORDER.map((t) => ({
                value: t,
                label: SERVICE_TYPES[t].label,
                icon: SERVICE_TYPES[t].icon,
              }))}
              value={type}
              onChange={setType}
              columns={3}
              size="sm"
            />
          </div>

          <div>
            <Label htmlFor="sv-desc">Descripción</Label>
            <Input
              id="sv-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Aéreo EZE–GIG ida y vuelta, GOL"
              autoFocus={!isEdit}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="sv-supplier">Proveedor</Label>
              <Select
                id="sv-supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">Sin proveedor</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="sv-code">Código de reserva</Label>
              <Input
                id="sv-code"
                value={reservationCode}
                onChange={(e) => setReservationCode(e.target.value)}
                placeholder="Ej: ABC123"
                className="font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sv-from">Desde</Label>
              <Input
                id="sv-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sv-to">Hasta</Label>
              <Input
                id="sv-to"
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          {/* fecha de caída: el margen para pagarle al proveedor antes de perder la reserva */}
          <div className="rounded-xl border border-line bg-sand-soft/50 p-3">
            <Label htmlFor="sv-deadline">Fecha de caída de la reserva</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="sv-deadline"
                type="date"
                value={deadlineDate}
                onChange={(e) => setDeadlineDate(e.target.value)}
                className="w-full sm:w-48"
              />
              {deadlineDate && <DeadlineChip date={deadlineDate} />}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-faint">
              Hasta cuándo hay tiempo de pagarla. Te avisamos cuando se acerca.
            </p>
          </div>

          <div>
            <Label>Fotos y comprobantes</Label>
            <ServiceImagesField
              agencyId={agencyId}
              fileId={fileId}
              value={images}
              onChange={setImages}
              onUploadingChange={setUploadingImages}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sv-cost">Costo ({currency})</Label>
              <Input
                id="sv-cost"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="0"
                className="text-right tabular-nums"
              />
            </div>
            <div>
              <Label htmlFor="sv-price">Precio de venta ({currency})</Label>
              <Input
                id="sv-price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
                className="text-right tabular-nums"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-sand-soft/60 px-3.5 py-2.5">
            <span className="text-sm text-ink-soft">Utilidad del servicio</span>
            <span
              className={cn(
                "font-semibold tabular-nums",
                utility > 0
                  ? "text-money-text"
                  : utility < 0
                    ? "text-tone-red-text"
                    : "text-ink-faint",
              )}
            >
              {fmtMoney(utility, currency)}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {uploadingImages && (
              <p className="mr-auto text-[11px] text-ink-faint">Esperá, se están subiendo las fotos.</p>
            )}
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={!canSave} loading={loading}>
              {isEdit ? "Guardar cambios" : "Agregar servicio"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
