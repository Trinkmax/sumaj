"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { fmtDate } from "@/lib/format";
import { updateContact } from "@/lib/actions/contacts";
import { DOC_TYPE_LABELS, DOC_TYPE_KEYS, birthdayThisMonth, type ContactRow } from "./types";
import type { DocumentType } from "@/lib/types";

export function DatosCard({ contact }: { contact: ContactRow }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

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
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
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
    toast.success("Datos guardados 👌");
    router.refresh();
  };

  const rows: { label: string; value: React.ReactNode }[] = [
    {
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
      label: "Nacimiento",
      value: contact.birth_date ? (
        <span>
          {fmtDate(contact.birth_date)}
          {birthdayThisMonth(contact.birth_date) && (
            <span className="ml-1.5" title="Cumple años este mes">
              🎂
            </span>
          )}
        </span>
      ) : null,
    },
    { label: "Dirección", value: contact.address },
    { label: "Notas", value: contact.notes },
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
                  <dt className="w-24 shrink-0 text-ink-faint">{r.label}</dt>
                  <dd className="min-w-0 whitespace-pre-line text-ink">{r.value}</dd>
                </div>
              ),
          )}
        </dl>
      ) : (
        <p className="text-sm text-ink-faint">
          Sin datos cargados todavía. Completalos con el lápiz ✏️
        </p>
      )}

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
              <div>
                <Label htmlFor="dc-doctype">Tipo de documento</Label>
                <Select id="dc-doctype" value={form.documentType} onChange={set("documentType")}>
                  <option value="">Sin documento</option>
                  {DOC_TYPE_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {DOC_TYPE_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </div>
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
              <div>
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
