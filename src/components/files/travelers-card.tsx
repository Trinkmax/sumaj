"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUpRight,
  BookUser,
  CircleHelp,
  IdCard,
  Plus,
  Stamp,
  UserPlus,
  X,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Checkbox, EmptyState, Tooltip, ChoiceGrid } from "@/components/ui/misc";
import { Avatar } from "@/components/ui/avatar";
import { createTravelerForFile, linkTraveler, unlinkTraveler } from "@/lib/actions/files";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Enums } from "@/lib/types";
import { docExpiresBeforeTrip } from "./helpers";
import type { TravelerRow } from "./types";

const DOC_TYPES: { value: Enums<"document_type">; label: string; icon: typeof IdCard }[] = [
  { value: "dni", label: "DNI", icon: IdCard },
  { value: "pasaporte", label: "Pasaporte", icon: BookUser },
  { value: "visa", label: "Visa", icon: Stamp },
  { value: "otro", label: "Otro", icon: CircleHelp },
];

function docLabel(t: TravelerRow): string | null {
  if (!t.document_number) return null;
  const type = t.document_type ? DOC_TYPES.find((d) => d.value === t.document_type)?.label : "Doc";
  return `${type ?? "Doc"} ${t.document_number}`;
}

export function TravelersCard({
  fileId,
  linked,
  contactTravelers,
  returnDate,
  className,
}: {
  fileId: string;
  linked: TravelerRow[];
  contactTravelers: TravelerRow[];
  returnDate: string | null;
  className?: string;
}) {
  const [dialogOpen, setDialogOpen] = React.useState(false);

  /* estado local optimista, sincronizado con las props del server */
  const [local, setLocal] = React.useState<TravelerRow[]>(linked);
  React.useEffect(() => setLocal(linked), [linked]);

  const linkedIds = new Set(local.map((t) => t.id));

  const link = async (t: TravelerRow) => {
    setLocal((prev) => [...prev, t]);
    const res = await linkTraveler({ fileId, travelerId: t.id });
    if (!res.ok) {
      setLocal((prev) => prev.filter((x) => x.id !== t.id));
      toast.error(res.error);
    }
  };

  const unlink = async (t: TravelerRow) => {
    setLocal((prev) => prev.filter((x) => x.id !== t.id));
    const res = await unlinkTraveler({ fileId, travelerId: t.id });
    if (!res.ok) {
      setLocal((prev) => [...prev, t]);
      toast.error(res.error);
    }
  };

  return (
    <section className={cn("card animate-slide-up p-4 md:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-ink">
          Pasajeros
          {local.length > 0 && (
            <span className="ml-2 text-sm font-normal tabular-nums text-ink-faint">
              {local.length}
            </span>
          )}
        </h2>
        <Button variant="secondary" size="sm" onClick={() => setDialogOpen(true)}>
          <UserPlus /> Agregar
        </Button>
      </div>

      {local.length === 0 ? (
        <EmptyState
          icon={IdCard}
          title="Sin pasajeros todavía"
          description="Agregá quiénes viajan para tener los documentos a mano."
          action={
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <UserPlus /> Agregar pasajero
            </Button>
          }
        />
      ) : (
        <div
          className={cn("divide-y divide-line", local.length <= 14 && "stagger-children")}
        >
          {local.map((t) => {
            const doc = docLabel(t);
            const expiresBad = docExpiresBeforeTrip(t.document_expiry, returnDate);
            return (
              <div key={t.id} className="flex min-h-14 items-center gap-3 py-2.5">
                <Avatar name={t.full_name} className="size-9" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    <span className="truncate">{t.full_name}</span>
                    {t.linked_contact_id && (
                      <Link
                        href={`/clientes/${t.linked_contact_id}`}
                        className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-medium text-brand-text transition-all tap-highlight-none hover:shadow-sm active:scale-[0.97]"
                      >
                        Ver ficha
                        <ArrowUpRight className="size-3" strokeWidth={2} />
                      </Link>
                    )}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-faint">
                    {doc ? <span className="tabular-nums">{doc}</span> : <span>Sin documento</span>}
                    {t.document_expiry && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 tabular-nums",
                          expiresBad && "font-semibold text-tone-red-text",
                        )}
                      >
                        {expiresBad && <AlertTriangle className="size-3" strokeWidth={2} />}
                        vence {fmtDate(t.document_expiry)}
                      </span>
                    )}
                  </p>
                </div>
                <Tooltip content="Quitar del file">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => unlink(t)}
                    aria-label={`Quitar a ${t.full_name}`}
                  >
                    <X />
                  </Button>
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}

      {dialogOpen && (
        <AddTravelerDialog
          fileId={fileId}
          contactTravelers={contactTravelers}
          linkedIds={linkedIds}
          returnDate={returnDate}
          onLink={link}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </section>
  );
}

/* ───────────────────────── agregar pasajero ───────────────────────── */

function AddTravelerDialog({
  fileId,
  contactTravelers,
  linkedIds,
  returnDate,
  onLink,
  open,
  onOpenChange,
}: {
  fileId: string;
  contactTravelers: TravelerRow[];
  linkedIds: Set<string>;
  returnDate: string | null;
  onLink: (t: TravelerRow) => void;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [showForm, setShowForm] = React.useState(false);
  const [fullName, setFullName] = React.useState("");
  const [docType, setDocType] = React.useState<Enums<"document_type">>("dni");
  const [docNumber, setDocNumber] = React.useState("");
  const [docExpiry, setDocExpiry] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const available = contactTravelers.filter((t) => !linkedIds.has(t.id));

  const createAndLink = async () => {
    if (fullName.trim().length < 2) return;
    setLoading(true);
    const res = await createTravelerForFile({
      fileId,
      fullName: fullName.trim(),
      documentType: docType,
      documentNumber: docNumber.trim() || null,
      documentExpiry: docExpiry || null,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Pasajero agregado");
    setFullName("");
    setDocNumber("");
    setDocExpiry("");
    setShowForm(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Agregar pasajeros"
        description="Tildá los viajeros del cliente o creá uno nuevo."
      >
        <div className="space-y-4">
          {available.length > 0 && (
            <div className="space-y-0.5 stagger-children">
              {available.map((t) => {
                const doc = docLabel(t);
                const expiresBad = docExpiresBeforeTrip(t.document_expiry, returnDate);
                return (
                  <label
                    key={t.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-sand-soft tap-highlight-none"
                  >
                    <Checkbox checked={false} onCheckedChange={() => onLink(t)} />
                    <Avatar name={t.full_name} className="size-8 text-[11px]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{t.full_name}</p>
                      <p className="truncate text-xs text-ink-faint">
                        {doc ?? "Sin documento"}
                        {t.document_expiry && (
                          <span className={cn(expiresBad && "font-semibold text-tone-red-text")}>
                            {" "}
                            · vence {fmtDate(t.document_expiry)}
                          </span>
                        )}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {available.length === 0 && !showForm && (
            <p className="rounded-xl bg-sand-soft/60 px-3.5 py-3 text-center text-[13px] text-ink-soft">
              El cliente no tiene más viajeros cargados. Creá uno nuevo acá abajo.
            </p>
          )}

          {showForm ? (
            <div className="space-y-3 rounded-xl border border-line bg-paper p-3.5 animate-slide-up">
              <p className="text-[13px] font-semibold text-ink">Nuevo pasajero</p>
              <div>
                <Label htmlFor="tv-name">Nombre completo</Label>
                <Input
                  id="tv-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ej: Julieta Suárez"
                  autoFocus
                />
              </div>
              <div>
                <Label>Documento</Label>
                <ChoiceGrid<Enums<"document_type">>
                  options={DOC_TYPES.map((d) => ({
                    value: d.value,
                    label: d.label,
                    icon: d.icon,
                  }))}
                  value={docType}
                  onChange={setDocType}
                  columns={4}
                  size="sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="tv-docnum">Número</Label>
                  <Input
                    id="tv-docnum"
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    placeholder="Ej: 32.456.789"
                  />
                </div>
                <div>
                  <Label htmlFor="tv-expiry">Vencimiento</Label>
                  <Input
                    id="tv-expiry"
                    type="date"
                    value={docExpiry}
                    onChange={(e) => setDocExpiry(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={createAndLink}
                  disabled={fullName.trim().length < 2}
                  loading={loading}
                >
                  Crear y agregar
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" className="w-full" onClick={() => setShowForm(true)}>
              <Plus /> Nuevo pasajero
            </Button>
          )}

          <div className="flex justify-end">
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              Listo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
