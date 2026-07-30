"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, Check, DollarSign, Plus, Search, UserPlus } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { ChoiceGrid } from "@/components/ui/misc";
import { Avatar } from "@/components/ui/avatar";
import { createFile } from "@/lib/actions/files";
import { fmtPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ContactOption, MemberOption } from "./types";

/** el botón vive en el PageHeader: esto lo abre desde cualquier lado de la página */
const OPEN_EVENT = "viajeros:new-file";

export function openNewFileDialog() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function NewFileButton({
  contacts,
  members,
  myMemberId,
}: {
  contacts: ContactOption[];
  members: MemberOption[];
  myMemberId: string;
}) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Nuevo file
      </Button>
      {open && (
        <NewFileDialog
          open={open}
          onOpenChange={setOpen}
          contacts={contacts}
          members={members}
          myMemberId={myMemberId}
        />
      )}
    </>
  );
}

function NewFileDialog({
  open,
  onOpenChange,
  contacts,
  members,
  myMemberId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contacts: ContactOption[];
  members: MemberOption[];
  myMemberId: string;
}) {
  const router = useRouter();
  const [contactQuery, setContactQuery] = React.useState("");
  const [contactId, setContactId] = React.useState<string | null>(null);
  const [destination, setDestination] = React.useState("");
  const [departure, setDeparture] = React.useState("");
  const [ret, setRet] = React.useState("");
  const [sellerId, setSellerId] = React.useState(myMemberId);
  const [currency, setCurrency] = React.useState<"USD" | "ARS">("USD");
  const [loading, setLoading] = React.useState(false);

  const selected = contacts.find((c) => c.id === contactId) ?? null;

  const filteredContacts = React.useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    if (!q) return contacts.slice(0, 30);
    return contacts
      .filter(
        (c) =>
          c.full_name.toLowerCase().includes(q) ||
          (qDigits.length >= 3 && c.phone?.includes(qDigits)),
      )
      .slice(0, 30);
  }, [contacts, contactQuery]);

  const canSave = !!contactId && destination.trim().length >= 2;

  const submit = async () => {
    if (!canSave || !contactId) return;
    setLoading(true);
    const res = await createFile({
      contactId,
      destination: destination.trim(),
      departureDate: departure || null,
      returnDate: ret || null,
      sellerId,
      currency,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`¡File ${res.data.code} creado!`);
    onOpenChange(false);
    router.push(`/files/${res.data.fileId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Nuevo file"
        description="Carga directa de una venta, sin pasar por el CRM."
      >
        <div className="space-y-4">
          {/* contacto */}
          <div>
            <Label>Cliente</Label>
            {selected ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-paper px-3 py-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={selected.full_name} className="size-8 text-[11px]" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{selected.full_name}</p>
                    {selected.phone && (
                      <p className="truncate text-xs text-ink-faint">{fmtPhone(selected.phone)}</p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setContactId(null);
                    setContactQuery("");
                  }}
                >
                  Cambiar
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-paper">
                <div className="relative border-b border-line">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
                  <input
                    value={contactQuery}
                    onChange={(e) => setContactQuery(e.target.value)}
                    placeholder="Buscar contacto…"
                    className="h-10 w-full rounded-t-xl bg-transparent pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-faint"
                    autoFocus
                  />
                </div>
                <div className="max-h-48 overflow-y-auto p-1">
                  {filteredContacts.length === 0 ? (
                    /* sin cliente no hay file: el atajo tiene que ser una acción, no un texto */
                    <div className="px-3 py-4 text-center">
                      <p className="text-[13px] text-ink-faint">
                        {contacts.length === 0
                          ? "Todavía no cargaste clientes."
                          : "No encontramos contactos con eso."}
                      </p>
                      <Link href="/clientes" className="mt-2.5 inline-block">
                        <Button variant="secondary" size="sm">
                          <UserPlus /> Crear el cliente
                        </Button>
                      </Link>
                      <p className="mt-1.5 text-[11px] text-ink-faint">
                        Te llevamos a Clientes para cargar la ficha.
                      </p>
                    </div>
                  ) : (
                    filteredContacts.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setContactId(c.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors tap-highlight-none",
                          "hover:bg-sand-soft active:bg-sand-soft",
                        )}
                      >
                        <Avatar name={c.full_name} className="size-7 text-[10px]" />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">
                          {c.full_name}
                        </span>
                        {c.phone && (
                          <span className="shrink-0 text-xs text-ink-faint">
                            {fmtPhone(c.phone)}
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* destino */}
          <div>
            <Label htmlFor="nf-dest">Destino</Label>
            <Input
              id="nf-dest"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Ej: Río de Janeiro, Brasil"
            />
          </div>

          {/* fechas */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="nf-dep">Salida</Label>
              <Input
                id="nf-dep"
                type="date"
                value={departure}
                onChange={(e) => setDeparture(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="nf-ret">Regreso</Label>
              <Input
                id="nf-ret"
                type="date"
                value={ret}
                min={departure || undefined}
                onChange={(e) => setRet(e.target.value)}
              />
            </div>
          </div>

          {/* vendedor + moneda */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="nf-seller">Vendedor</Label>
              <Select
                id="nf-seller"
                value={sellerId}
                onChange={(e) => setSellerId(e.target.value)}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                    {m.id === myMemberId ? " (yo)" : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Moneda del file</Label>
              <ChoiceGrid<"USD" | "ARS">
                value={currency}
                onChange={setCurrency}
                columns={2}
                size="sm"
                options={[
                  { value: "USD", label: "Dólares", icon: DollarSign, hint: "USD" },
                  { value: "ARS", label: "Pesos", icon: Banknote, hint: "ARS" },
                ]}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={!canSave} loading={loading}>
              <Check /> Crear file
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
