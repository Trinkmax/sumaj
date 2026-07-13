"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Cake,
  EllipsisVertical,
  IdCard,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { ChoiceGrid } from "@/components/ui/misc";
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import { fmtDate } from "@/lib/format";
import {
  addTraveler,
  updateTraveler,
  deleteTraveler,
  promoteTravelerToContact,
} from "@/lib/actions/contacts";
import {
  DOC_TYPE_LABELS,
  DOC_TYPE_KEYS,
  birthdayThisMonth,
  expiresSoon,
  expiryCountdown,
  isExpired,
  type TravelerRow,
  type TravelsWithRow,
} from "./types";
import type { DocumentType } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TravelersCard({
  contactId,
  contactName,
  travelers,
  travelsWith,
}: {
  contactId: string;
  contactName: string;
  travelers: TravelerRow[];
  travelsWith: TravelsWithRow[];
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<TravelerRow | null>(null);
  const [deleting, setDeleting] = React.useState<TravelerRow | null>(null);
  const [deletingBusy, setDeletingBusy] = React.useState(false);
  const [promoting, setPromoting] = React.useState<string | null>(null);

  // alta inline optimista
  const nameRef = React.useRef<HTMLInputElement>(null);
  const [newName, setNewName] = React.useState("");
  const [newRel, setNewRel] = React.useState("");
  const [pending, setPending] = React.useState<{ id: string; name: string; rel: string }[]>([]);

  React.useEffect(() => {
    // cuando el server devuelve la lista fresca, limpiamos los optimistas ya persistidos
    setPending((prev) => prev.filter((p) => !travelers.some((t) => t.full_name === p.name)));
  }, [travelers]);

  const addInline = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    const rel = newRel.trim();
    if (name.length < 2) {
      toast.error("Poné el nombre de la persona.");
      return;
    }
    const temp = { id: `tmp-${Date.now()}`, name, rel };
    setPending((prev) => [...prev, temp]);
    setNewName("");
    setNewRel("");
    nameRef.current?.focus();

    const res = await addTraveler({ contactId, fullName: name, relationship: rel || null });
    if (!res.ok) {
      setPending((prev) => prev.filter((p) => p.id !== temp.id));
      setNewName(name);
      setNewRel(rel);
      toast.error(res.error);
      return;
    }
    router.refresh();
  };

  const promote = async (t: TravelerRow) => {
    setPromoting(t.id);
    const res = await promoteTravelerToContact({ travelerId: t.id });
    setPromoting(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Ficha creada para ${t.full_name}.`);
    router.push(`/clientes/${res.data.contactId}`);
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
      <div className="mb-3 flex items-center gap-2">
        <Users className="size-4.5 text-ink-faint" strokeWidth={1.9} />
        <h2 className="font-display text-lg font-semibold text-ink">Grupo de viaje</h2>
        {travelers.length > 0 && (
          <span className="rounded-full bg-sand-soft px-2 text-[11px] font-semibold leading-5 tabular-nums text-ink-soft">
            {travelers.length}
          </span>
        )}
      </div>

      {travelers.length === 0 && pending.length === 0 ? (
        <p className="mb-3 text-sm text-ink-faint">
          Sumá a las personas que viajan con {contactName.split(" ")[0]}: pareja, hijos, amigos.
          Con el nombre alcanza; el documento se completa después.
        </p>
      ) : (
        <ul className="stagger-children divide-y divide-line">
          {travelers.map((t) => (
            <TravelerRowItem
              key={t.id}
              traveler={t}
              promoting={promoting === t.id}
              onPromote={() => promote(t)}
              onEdit={() => {
                setEditing(t);
                setFormOpen(true);
              }}
              onDelete={() => setDeleting(t)}
            />
          ))}
          {pending.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5 opacity-60">
              <Avatar name={p.name} className="size-9 text-[11px]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                <p className="text-xs text-ink-faint">guardando…</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* alta sin fricción: nombre + relación, Enter guarda */}
      <form
        onSubmit={addInline}
        className={cn(
          "flex items-center gap-2",
          travelers.length > 0 || pending.length > 0 ? "mt-3 border-t border-line pt-3" : "",
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-faint">
          <UserPlus className="size-4" strokeWidth={1.9} />
        </span>
        <Input
          ref={nameRef}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Agregar persona…"
          className="h-9 flex-1 text-sm"
          aria-label="Nombre de la persona"
        />
        <Input
          value={newRel}
          onChange={(e) => setNewRel(e.target.value)}
          placeholder="relación"
          className="h-9 w-24 text-sm sm:w-28"
          aria-label="Relación (pareja, hijo, madre…)"
        />
        <Button
          type="submit"
          variant="secondary"
          size="icon-sm"
          className="shrink-0 rounded-full"
          aria-label="Agregar al grupo"
          disabled={newName.trim().length < 2}
        >
          <Plus />
        </Button>
      </form>

      {/* navegación inversa: grupos donde esta persona viaja como pasajera */}
      {travelsWith.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Viaja con
          </p>
          <div className="flex flex-wrap gap-1.5">
            {travelsWith.map((tw) => (
              <Link
                key={tw.travelerId}
                href={`/clientes/${tw.owner.id}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-paper pl-1 pr-2.5 text-[13px] font-medium text-ink-soft transition-all duration-150 tap-highlight-none hover:border-line-strong hover:bg-sand-soft/60 hover:text-ink active:scale-[0.97]"
              >
                <Avatar name={tw.owner.full_name} className="size-6 text-[9px]" />
                <span className="max-w-36 truncate">{tw.owner.full_name}</span>
                {tw.relationship && (
                  <span className="text-[11px] text-ink-faint">· {tw.relationship}</span>
                )}
              </Link>
            ))}
          </div>
        </div>
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
          description={`¿Seguro que querés eliminar a ${deleting?.full_name ?? ""} del grupo de viaje?${
            deleting?.linked_contact_id ? " Su ficha de contacto no se borra." : ""
          }`}
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

function TravelerRowItem({
  traveler: t,
  promoting,
  onPromote,
  onEdit,
  onDelete,
}: {
  traveler: TravelerRow;
  promoting: boolean;
  onPromote: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const docLabel =
    t.document_type || t.document_number
      ? [t.document_type ? DOC_TYPE_LABELS[t.document_type] : null, t.document_number]
          .filter(Boolean)
          .join(" ")
      : null;

  const expiry = t.document_expiry;
  const expired = isExpired(expiry);
  const soon = !expired && expiresSoon(expiry);

  return (
    <li className="flex items-center gap-3 py-2.5 first:pt-0">
      <Avatar name={t.full_name} className="size-9 text-[11px]" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <p className="truncate text-sm font-medium text-ink">{t.full_name}</p>
          {t.relationship && <Badge>{t.relationship}</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
          {t.birth_date && (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                birthdayThisMonth(t.birth_date) && "font-medium text-tone-pink-text",
              )}
              title={birthdayThisMonth(t.birth_date) ? "Cumple años este mes" : undefined}
            >
              <Cake className="size-3" strokeWidth={2} />
              {fmtDate(t.birth_date)}
            </span>
          )}
          {docLabel && !expired && !soon && (
            <span className="inline-flex items-center gap-1">
              <IdCard className="size-3" strokeWidth={2} />
              {docLabel}
            </span>
          )}
          {expiry && (expired || soon) && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-medium",
                expired
                  ? "border-tone-red-line bg-tone-red-soft text-tone-red-text"
                  : "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
              )}
            >
              <IdCard className="size-3" strokeWidth={2} />
              {expiryCountdown(expiry)}
            </span>
          )}
          {!t.birth_date && !docLabel && (
            <button
              onClick={onEdit}
              className="text-xs text-ink-faint underline decoration-line underline-offset-2 transition-colors tap-highlight-none hover:text-ink-soft"
            >
              completar datos
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {t.linked_contact_id ? (
          <Link
            href={`/clientes/${t.linked_contact_id}`}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-line bg-paper px-2.5 text-[12px] font-medium text-ink-soft transition-all duration-150 tap-highlight-none hover:border-line-strong hover:bg-sand-soft/60 hover:text-ink active:scale-[0.97]"
          >
            Ver ficha <ArrowUpRight className="size-3.5" />
          </Link>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="h-8 rounded-full px-2.5 text-[12px]"
            loading={promoting}
            onClick={onPromote}
          >
            {!promoting && <UserPlus />} Crear ficha
          </Button>
        )}

        <Dropdown>
          <DropdownTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Opciones de ${t.full_name}`}>
              <EllipsisVertical />
            </Button>
          </DropdownTrigger>
          <DropdownContent align="end">
            <DropdownItem onSelect={onEdit}>
              <Pencil /> Editar datos
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem destructive onSelect={onDelete}>
              <Trash2 /> Eliminar del grupo
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
    </li>
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
    notes: traveler?.notes ?? "",
  });

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
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
      notes: form.notes.trim() || null,
    };
    const res = traveler
      ? await updateTraveler({ travelerId: traveler.id, ...payload })
      : await addTraveler(payload);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(traveler ? "Pasajero actualizado." : "Pasajero agregado.");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={traveler ? "Editar pasajero" : "Agregar pasajero"}
        description="Con el vencimiento del documento cargado, te avisamos antes de que venza."
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
              <Label htmlFor="tv-docnum">Número</Label>
              <Input id="tv-docnum" value={form.documentNumber} onChange={set("documentNumber")} />
            </div>
            <div>
              <Label htmlFor="tv-expiry">Vencimiento</Label>
              <Input
                id="tv-expiry"
                type="date"
                value={form.documentExpiry}
                onChange={set("documentExpiry")}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="tv-notes">Notas</Label>
            <Textarea
              id="tv-notes"
              value={form.notes}
              onChange={set("notes")}
              placeholder="Alergias, asiento preferido, lo que haga falta recordar…"
              className="min-h-[68px]"
            />
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
