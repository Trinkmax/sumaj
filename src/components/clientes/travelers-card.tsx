"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { fmtDate } from "@/lib/format";
import { addTraveler, updateTraveler, deleteTraveler } from "@/lib/actions/contacts";
import {
  DOC_TYPE_LABELS,
  DOC_TYPE_KEYS,
  expiresSoon,
  isExpired,
  type TravelerRow,
} from "./types";
import type { DocumentType } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TravelersCard({
  contactId,
  travelers,
}: {
  contactId: string;
  travelers: TravelerRow[];
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<TravelerRow | null>(null);
  const [deleting, setDeleting] = React.useState<TravelerRow | null>(null);
  const [deletingBusy, setDeletingBusy] = React.useState(false);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (t: TravelerRow) => {
    setEditing(t);
    setFormOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    const res = await deleteTraveler({ travelerId: deleting.id, contactId });
    setDeletingBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setDeleting(null);
    toast.success("Pasajero eliminado.");
    router.refresh();
  };

  return (
    <section className="card animate-fade-in p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">Grupo de viaje</h2>
        <Button variant="secondary" size="sm" onClick={openNew}>
          <Plus /> Agregar
        </Button>
      </div>

      {travelers.length === 0 ? (
        <p className="text-sm text-ink-faint">
          Sumá a las personas que viajan con este cliente: familia, pareja, amigos.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {travelers.map((t) => (
            <li key={t.id} className="group flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <p className="text-sm font-medium text-ink">{t.full_name}</p>
                  {t.relationship && (
                    <span className="text-xs text-ink-faint">{t.relationship}</span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-soft">
                  {(t.document_type || t.document_number) && (
                    <span>
                      {[
                        t.document_type ? DOC_TYPE_LABELS[t.document_type] : null,
                        t.document_number,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    </span>
                  )}
                  {t.document_expiry && (
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        expiresSoon(t.document_expiry)
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-line bg-sand-soft text-ink-soft",
                      )}
                    >
                      {isExpired(t.document_expiry)
                        ? `venció ${fmtDate(t.document_expiry)}`
                        : `vence ${fmtDate(t.document_expiry)}`}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openEdit(t)}
                  aria-label={`Editar a ${t.full_name}`}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-ink-faint hover:bg-red-50 hover:text-red-600"
                  onClick={() => setDeleting(t)}
                  aria-label={`Eliminar a ${t.full_name}`}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <TravelerFormDialog
        key={`${editing?.id ?? "new"}-${formOpen}`}
        open={formOpen}
        onOpenChange={setFormOpen}
        contactId={contactId}
        traveler={editing}
        onSaved={() => {
          setFormOpen(false);
          router.refresh();
        }}
      />

      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent
          title="Eliminar pasajero"
          description={`¿Seguro que querés eliminar a ${deleting?.full_name ?? ""} del grupo de viaje?`}
        >
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={deletingBusy} onClick={confirmDelete}>
              Eliminar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function TravelerFormDialog({
  open,
  onOpenChange,
  contactId,
  traveler,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactId: string;
  traveler: TravelerRow | null;
  onSaved: () => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    fullName: traveler?.full_name ?? "",
    relationship: traveler?.relationship ?? "",
    documentType: (traveler?.document_type ?? "") as DocumentType | "",
    documentNumber: traveler?.document_number ?? "",
    documentExpiry: traveler?.document_expiry ?? "",
    birthDate: traveler?.birth_date ?? "",
  });

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.fullName.trim().length < 2) {
      toast.error("Poné el nombre del pasajero.");
      return;
    }
    setSaving(true);
    const payload = {
      contactId,
      fullName: form.fullName.trim(),
      relationship: form.relationship.trim() || null,
      documentType: form.documentType || null,
      documentNumber: form.documentNumber.trim() || null,
      documentExpiry: form.documentExpiry || null,
      birthDate: form.birthDate || null,
    };
    const res = traveler
      ? await updateTraveler({ travelerId: traveler.id, ...payload })
      : await addTraveler(payload);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(traveler ? "Pasajero actualizado 👌" : "Pasajero agregado 👌");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={traveler ? "Editar pasajero" : "Agregar pasajero"}
        description="Los datos del documento sirven para avisarte cuando esté por vencer."
      >
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="tv-name">Nombre completo *</Label>
            <Input id="tv-name" value={form.fullName} onChange={set("fullName")} autoFocus required />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="tv-rel">Relación</Label>
              <Input
                id="tv-rel"
                value={form.relationship}
                onChange={set("relationship")}
                placeholder="Ej: pareja, hijo, madre"
              />
            </div>
            <div>
              <Label htmlFor="tv-birth">Fecha de nacimiento</Label>
              <Input id="tv-birth" type="date" value={form.birthDate} onChange={set("birthDate")} />
            </div>
            <div>
              <Label htmlFor="tv-doctype">Tipo de documento</Label>
              <Select id="tv-doctype" value={form.documentType} onChange={set("documentType")}>
                <option value="">Sin documento</option>
                {DOC_TYPE_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {DOC_TYPE_LABELS[k]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="tv-docnum">Número</Label>
              <Input id="tv-docnum" value={form.documentNumber} onChange={set("documentNumber")} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="tv-expiry">Vencimiento del documento</Label>
              <Input
                id="tv-expiry"
                type="date"
                value={form.documentExpiry}
                onChange={set("documentExpiry")}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              {traveler ? "Guardar cambios" : "Agregar pasajero"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
