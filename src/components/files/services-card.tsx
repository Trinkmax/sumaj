"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ArrowRight,
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
} from "@/lib/actions/files";
import { SERVICE_TYPES, SERVICE_ORDER, round2 } from "@/lib/domain";
import { fmtDate, fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ServiceType } from "@/lib/types";
import { numToInput, parseAmount } from "./helpers";
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

export function ServicesCard({
  fileId,
  currency,
  services,
  suppliers,
  sellerName,
  commissionPct,
  className,
}: {
  fileId: string;
  currency: string;
  services: ServiceRow[];
  suppliers: SupplierOption[];
  sellerName: string;
  commissionPct: number;
  className?: string;
}) {
  const [dialogService, setDialogService] = React.useState<ServiceRow | "new" | null>(null);
  const [toDelete, setToDelete] = React.useState<ServiceRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  /* toggle "pagado a proveedor" optimista */
  const [paidOverrides, setPaidOverrides] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => setPaidOverrides({}), [services]);

  const isPaid = (s: ServiceRow) => paidOverrides[s.id] ?? s.paid_to_supplier;

  const togglePaid = async (s: ServiceRow) => {
    const next = !isPaid(s);
    setPaidOverrides((prev) => ({ ...prev, [s.id]: next }));
    const res = await toggleServicePaid({ serviceId: s.id, fileId, paid: next });
    if (!res.ok) {
      setPaidOverrides((prev) => ({ ...prev, [s.id]: !next }));
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

  const totalCost = round2(services.reduce((a, s) => a + s.cost, 0));
  const totalSale = round2(services.reduce((a, s) => a + s.price, 0));
  const utility = round2(totalSale - totalCost);
  const commission = round2((utility * commissionPct) / 100);

  return (
    <section className={cn("card animate-slide-up p-4 md:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-ink">Servicios</h2>
        <Button variant="secondary" size="sm" onClick={() => setDialogService("new")}>
          <Plus /> Agregar
        </Button>
      </div>

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
            {commissionPct > 0 && (
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-ink-faint">
                  Comisión {sellerName} ({commissionPct}%)
                </span>
                <span className="font-medium tabular-nums text-ink-soft">
                  {fmtMoney(commission, currency)}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {dialogService && (
        <ServiceDialog
          fileId={fileId}
          currency={currency}
          suppliers={suppliers}
          service={dialogService === "new" ? null : dialogService}
          open
          onOpenChange={(o) => !o && setDialogService(null)}
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
              <Switch checked={paid} onCheckedChange={onTogglePaid} />
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

      {/* mobile: switch con label explícito */}
      <label className="mt-1.5 flex min-h-6 w-fit items-center gap-2 text-xs text-ink-faint tap-highlight-none md:hidden">
        <Switch checked={paid} onCheckedChange={onTogglePaid} />
        {paid ? "Pagado a proveedor" : "Debe al proveedor"}
      </label>
    </div>
  );
}

/* ───────────────────────── alta / edición ───────────────────────── */

function ServiceDialog({
  fileId,
  currency,
  suppliers,
  service,
  open,
  onOpenChange,
}: {
  fileId: string;
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
  const [cost, setCost] = React.useState(numToInput(service?.cost));
  const [price, setPrice] = React.useState(numToInput(service?.price));
  const [loading, setLoading] = React.useState(false);

  const costNum = parseAmount(cost);
  const priceNum = parseAmount(price);
  const utility = round2(priceNum - costNum);
  const canSave = description.trim().length > 0;

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

          <div className="flex justify-end gap-2">
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
