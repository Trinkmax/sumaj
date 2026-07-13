"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Switch, EmptyState, Tooltip } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/config/confirm-dialog";
import { deleteSupplier, upsertSupplier } from "@/lib/actions/settings";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Tables } from "@/lib/types";

type Supplier = Tables<"suppliers">;

export function SuppliersManager({ suppliers }: { suppliers: Supplier[] }) {
  const [editing, setEditing] = React.useState<Supplier | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<Supplier | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          El % de comisión se autocompleta al cotizar. Tucano Tours ya viene cargado.
        </p>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <Plus />
          <span className="hidden sm:inline">Nuevo proveedor</span>
          <span className="sm:hidden">Nuevo</span>
        </Button>
      </div>

      {suppliers.length === 0 ? (
        <EmptyState
          emoji="🤝"
          title="Todavía no hay proveedores"
          description="Cargá tus mayoristas para autocompletar comisiones al cotizar."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Cargar proveedor
            </Button>
          }
        />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden animate-slide-up">
          {suppliers.map((s) => (
            <SupplierRow
              key={s.id}
              supplier={s}
              onEdit={() => setEditing(s)}
              onDelete={() => setToDelete(s)}
            />
          ))}
        </ul>
      )}

      <SupplierDialog
        key={editing?.id ?? "new"}
        open={createOpen || editing !== null}
        supplier={editing}
        onOpenChange={(o) => {
          if (!o) {
            setCreateOpen(false);
            setEditing(null);
          }
        }}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`¿Eliminar a ${toDelete?.name}?`}
        description="Si tiene cotizaciones o servicios asociados no se va a poder: en ese caso desactivalo."
        onConfirm={async () => {
          if (!toDelete) return;
          const res = await deleteSupplier({ id: toDelete.id });
          if (!res.ok) {
            toast.error(res.error);
          } else {
            toast.success("Proveedor eliminado.");
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}

function SupplierRow({
  supplier,
  onEdit,
  onDelete,
}: {
  supplier: Supplier;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [active, setActive] = React.useState(supplier.is_active);

  async function toggle(next: boolean) {
    const prev = active;
    setActive(next); // optimista
    const res = await upsertSupplier({
      id: supplier.id,
      name: supplier.name,
      website: supplier.website,
      default_commission_pct: Number(supplier.default_commission_pct),
      notes: supplier.notes,
      is_active: next,
    });
    if (!res.ok) {
      setActive(prev);
      toast.error(res.error);
    }
  }

  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 transition-opacity", !active && "opacity-55")}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-ink">{supplier.name}</p>
          {supplier.website && (
            <a
              href={supplier.website.startsWith("http") ? supplier.website : `https://${supplier.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-xs text-brand-600 hover:underline"
            >
              <Globe className="size-3" />
              web
            </a>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-ink-faint">
          <span className="tabular-nums">{fmtNumber(Number(supplier.default_commission_pct), 0)}%</span> comisión por
          defecto
          {supplier.notes ? ` · ${supplier.notes}` : ""}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Switch checked={active} onCheckedChange={toggle} aria-label={`${supplier.name} activo`} />
        <Tooltip content="Editar">
          <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label={`Editar ${supplier.name}`}>
            <Pencil />
          </Button>
        </Tooltip>
        <Tooltip content="Eliminar">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onDelete}
            aria-label={`Eliminar ${supplier.name}`}
            className="text-red-500 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 />
          </Button>
        </Tooltip>
      </div>
    </li>
  );
}

function SupplierDialog({
  open,
  supplier,
  onOpenChange,
}: {
  open: boolean;
  supplier: Supplier | null;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = React.useState(supplier?.name ?? "");
  const [website, setWebsite] = React.useState(supplier?.website ?? "");
  const [commission, setCommission] = React.useState(
    supplier ? String(Number(supplier.default_commission_pct)) : "10",
  );
  const [notes, setNotes] = React.useState(supplier?.notes ?? "");
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pct = Number(commission.replace(",", "."));
    if (isNaN(pct) || pct < 0 || pct > 100) {
      toast.error("La comisión tiene que estar entre 0 y 100.");
      return;
    }
    setLoading(true);
    const res = await upsertSupplier({
      id: supplier?.id,
      name: name.trim(),
      website: website.trim() || null,
      default_commission_pct: pct,
      notes: notes.trim() || null,
      is_active: supplier?.is_active ?? true,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(supplier ? "Proveedor guardado." : `${name.trim()} cargado 🤝`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent
        title={supplier ? "Editar proveedor" : "Nuevo proveedor"}
        description="Mayoristas y operadores con los que trabajás."
        size="md"
      >
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="sup-name">Nombre *</Label>
            <Input
              id="sup-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Tucano Tours"
              maxLength={120}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="sup-web">Sitio web</Label>
              <Input
                id="sup-web"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="tucanotours.com.ar"
                inputMode="url"
                maxLength={200}
              />
            </div>
            <div>
              <Label htmlFor="sup-comm">Comisión por defecto</Label>
              <div className="relative">
                <Input
                  id="sup-comm"
                  value={commission}
                  onChange={(e) => setCommission(e.target.value)}
                  inputMode="decimal"
                  className="pr-7 text-right tabular-nums"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint">
                  %
                </span>
              </div>
            </div>
          </div>
          <div>
            <Label htmlFor="sup-notes">Notas</Label>
            <Textarea
              id="sup-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contacto, condiciones, horarios…"
              maxLength={500}
              className="min-h-[72px]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading}>
              {supplier ? "Guardar" : "Crear proveedor"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
