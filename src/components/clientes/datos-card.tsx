"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BellOff,
  Cake,
  Home,
  IdCard,
  Megaphone,
  NotebookPen,
  Pencil,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { ChoiceGrid } from "@/components/ui/misc";
import { fmtDate } from "@/lib/format";
import { updateContact } from "@/lib/actions/contacts";
import { optOutContact, undoOptOut } from "@/lib/actions/broadcasts";
import { DOC_TYPE_LABELS, DOC_TYPE_KEYS, birthdayThisMonth, type ContactRow } from "./types";
import type { DocumentType } from "@/lib/types";

export function DatosCard({ contact }: { contact: ContactRow }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [cambiandoBaja, setCambiandoBaja] = React.useState(false);

  const deBaja = Boolean(contact.wa_opt_out_at);

  /* "Che, no me manden más promos" llega por chat al vendedor, no a un admin.
     Hasta acá las actions existían y no las llamaba nadie: la única baja posible
     era que la persona tocara el botón de la plantilla. El que no tenía forma de
     que se lo respeten terminaba bloqueando el número madre, que es exactamente
     lo que le baja la calidad —y el límite de envío— a toda la agencia. */
  async function cambiarBaja() {
    setCambiandoBaja(true);
    const res = deBaja
      ? await undoOptOut({ contactId: contact.id })
      : await optOutContact({ contactId: contact.id });
    setCambiandoBaja(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      deBaja
        ? "Vuelve a recibir difusiones."
        : "Listo: no le van a llegar más difusiones. Por chat le seguís escribiendo igual.",
    );
    router.refresh();
  }

  const [form, setForm] = React.useState({
    fullName: contact.full_name,
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    instagram: contact.instagram ?? "",
    city: contact.city ?? "",
    documentType: (contact.document_type ?? "") as DocumentType | "",
    documentNumber: contact.document_number ?? "",
    birthDate: contact.birth_date ?? "",
    address: contact.address ?? "",
    notes: contact.notes ?? "",
  });

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.fullName.trim().length < 2) {
      toast.error("El nombre no puede quedar vacío.");
      return;
    }
    setSaving(true);
    const res = await updateContact({
      contactId: contact.id,
      fullName: form.fullName.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      instagram: form.instagram.trim() || null,
      city: form.city.trim() || null,
      documentType: form.documentType || null,
      documentNumber: form.documentNumber.trim() || null,
      birthDate: form.birthDate || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setOpen(false);
    toast.success("Datos guardados.");
    router.refresh();
  };

  const rows: { icon: LucideIcon; label: string; value: React.ReactNode }[] = [
    {
      icon: IdCard,
      label: "Documento",
      value:
        contact.document_type || contact.document_number
          ? [
              contact.document_type ? DOC_TYPE_LABELS[contact.document_type] : null,
              contact.document_number,
            ]
              .filter(Boolean)
              .join(" ")
          : null,
    },
    {
      icon: Cake,
      label: "Nacimiento",
      value: contact.birth_date ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {fmtDate(contact.birth_date)}
          {birthdayThisMonth(contact.birth_date) && (
            <span className="inline-flex items-center gap-1 rounded-full border border-tone-pink-line bg-tone-pink-soft px-1.5 py-px text-[11px] font-medium text-tone-pink-text">
              <Cake className="size-3" strokeWidth={2} /> cumple este mes
            </span>
          )}
        </span>
      ) : null,
    },
    { icon: Home, label: "Dirección", value: contact.address },
    { icon: StickyNote, label: "Notas", value: contact.notes },
  ];

  const hasData = rows.some((r) => r.value);

  return (
    <section className="card animate-fade-in p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">Datos</h2>
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label="Editar datos">
          <Pencil />
        </Button>
      </div>

      {hasData ? (
        <dl className="space-y-2.5">
          {rows.map(
            (r) =>
              r.value && (
                <div key={r.label} className="flex gap-3 text-sm">
                  <dt className="flex w-28 shrink-0 items-center gap-1.5 self-start text-ink-faint">
                    <r.icon className="size-3.5" strokeWidth={1.9} />
                    {r.label}
                  </dt>
                  <dd className="min-w-0 whitespace-pre-line text-ink">{r.value}</dd>
                </div>
              ),
          )}
        </dl>
      ) : (
        <div className="flex flex-col items-start gap-2.5 rounded-xl border border-dashed border-line-strong/70 px-4 py-4">
          <div className="flex items-center gap-2 text-sm text-ink-faint">
            <NotebookPen className="size-4" strokeWidth={1.9} />
            Documento, cumpleaños, dirección… todavía sin cargar.
          </div>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            <Pencil /> Completar datos
          </Button>
        </div>
      )}

      {/* Difusiones: estado a la vista y un solo toque para cambiarlo. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <p className="flex min-w-0 items-start gap-2 text-[13px] text-ink-soft">
          {deBaja ? (
            <BellOff className="mt-0.5 size-3.5 shrink-0 text-ink-faint" strokeWidth={1.9} />
          ) : (
            <Megaphone className="mt-0.5 size-3.5 shrink-0 text-ink-faint" strokeWidth={1.9} />
          )}
          <span className="min-w-0">
            {deBaja
              ? `Se dio de baja de las difusiones${contact.wa_opt_out_reason ? ` — ${contact.wa_opt_out_reason}` : ""}.`
              : "Recibe las difusiones de la agencia."}
          </span>
        </p>
        <Button
          variant={deBaja ? "secondary" : "ghost"}
          size="sm"
          loading={cambiandoBaja}
          onClick={cambiarBaja}
          className="shrink-0"
        >
          {deBaja ? "Volver a incluirlo" : "Dar de baja"}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Editar datos" size="lg">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="dc-name">Nombre completo *</Label>
              <Input id="dc-name" value={form.fullName} onChange={set("fullName")} required />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="dc-phone">Teléfono</Label>
                <Input id="dc-phone" type="tel" value={form.phone} onChange={set("phone")} />
              </div>
              <div>
                <Label htmlFor="dc-email">Email</Label>
                <Input id="dc-email" type="email" value={form.email} onChange={set("email")} />
              </div>
              <div>
                <Label htmlFor="dc-ig">Instagram</Label>
                <Input
                  id="dc-ig"
                  value={form.instagram}
                  onChange={set("instagram")}
                  placeholder="@usuario"
                />
              </div>
              <div>
                <Label htmlFor="dc-city">Ciudad</Label>
                <Input id="dc-city" value={form.city} onChange={set("city")} />
              </div>
            </div>

            <div>
              <Label>Documento</Label>
              <ChoiceGrid<DocumentType | "">
                columns={5}
                size="sm"
                value={form.documentType}
                onChange={(v) =>
                  setForm((f) => ({ ...f, documentType: f.documentType === v ? "" : v }))
                }
                options={[
                  ...DOC_TYPE_KEYS.map((k) => ({
                    value: k as DocumentType | "",
                    label: DOC_TYPE_LABELS[k],
                    icon: IdCard,
                  })),
                  { value: "" as DocumentType | "", label: "Ninguno" },
                ]}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="dc-docnum">Número</Label>
                <Input
                  id="dc-docnum"
                  value={form.documentNumber}
                  onChange={set("documentNumber")}
                  placeholder="Ej: 32.456.789"
                />
              </div>
              <div>
                <Label htmlFor="dc-birth">Fecha de nacimiento</Label>
                <Input id="dc-birth" type="date" value={form.birthDate} onChange={set("birthDate")} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="dc-address">Dirección</Label>
                <Input id="dc-address" value={form.address} onChange={set("address")} />
              </div>
            </div>

            <div>
              <Label htmlFor="dc-notes">Notas</Label>
              <Textarea
                id="dc-notes"
                value={form.notes}
                onChange={set("notes")}
                placeholder="Preferencias, aclaraciones, lo que quieras recordar…"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={saving}>
                Guardar cambios
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
