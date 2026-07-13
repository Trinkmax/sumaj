"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ChoiceGrid } from "@/components/ui/misc";
import { normalizePhone, fmtPhone } from "@/lib/format";
import { CHANNELS } from "@/lib/domain";
import { createContact } from "@/lib/actions/contacts";
import { cn } from "@/lib/utils";
import type { LeadChannel } from "@/lib/types";

type DedupeContact = { id: string; full_name: string; phone: string | null };

export function NewContactButton({ contacts }: { contacts: DedupeContact[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [more, setMore] = React.useState(false);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [city, setCity] = React.useState("");
  const [source, setSource] = React.useState<LeadChannel>("manual");

  const duplicate = React.useMemo(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 6) return null;
    const normalized = normalizePhone(phone);
    return contacts.find((c) => c.phone && c.phone === normalized) ?? null;
  }, [phone, contacts]);

  const reset = () => {
    setName("");
    setPhone("");
    setEmail("");
    setCity("");
    setSource("manual");
    setMore(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      toast.error("Poné el nombre completo.");
      return;
    }
    setSaving(true);
    const res = await createContact({
      fullName: name,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      city: city.trim() || undefined,
      source,
    });
    setSaving(false);

    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Contacto creado.");
    setOpen(false);
    reset();
    router.push(`/clientes/${res.data.contactId}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="md:h-10 md:px-4 md:text-sm">
          <Plus /> Nuevo contacto
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Nuevo contacto"
        description="Con el nombre alcanza. El resto se completa cuando haga falta."
      >
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="nc-name">Nombre completo *</Label>
            <Input
              id="nc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Gabriela Suárez"
              autoFocus
              required
            />
          </div>

          <div>
            <Label htmlFor="nc-phone">Teléfono</Label>
            <Input
              id="nc-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej: 351 555 0118"
              type="tel"
              inputMode="tel"
            />
            {duplicate && (
              <div className="mt-2 flex animate-fade-in items-start gap-2 rounded-xl border border-tone-amber-line bg-tone-amber-soft px-3 py-2.5 text-[13px] text-tone-amber-text">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <p>
                  Ya existe{" "}
                  <Link
                    href={`/clientes/${duplicate.id}`}
                    className="font-semibold underline underline-offset-2"
                    onClick={() => setOpen(false)}
                  >
                    {duplicate.full_name}
                  </Link>{" "}
                  con el teléfono {fmtPhone(duplicate.phone)}. Fijate que no sea la misma persona.
                </p>
              </div>
            )}
          </div>

          {/* progressive disclosure: lo demás solo si hace falta */}
          {!more ? (
            <button
              type="button"
              onClick={() => setMore(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong/70 py-2 text-[13px] font-medium text-ink-soft transition-colors tap-highlight-none hover:border-ink-faint hover:text-ink"
            >
              <ChevronDown className="size-3.5" /> Más datos (email, ciudad, canal)
            </button>
          ) : (
            <div className="animate-slide-up space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="nc-email">Email</Label>
                  <Input
                    id="nc-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nombre@mail.com"
                    type="email"
                  />
                </div>
                <div>
                  <Label htmlFor="nc-city">Ciudad</Label>
                  <Input
                    id="nc-city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Ej: Córdoba"
                  />
                </div>
              </div>

              <div>
                <Label>¿Por dónde llegó?</Label>
                <ChoiceGrid<LeadChannel>
                  columns={4}
                  size="sm"
                  value={source}
                  onChange={setSource}
                  options={(Object.entries(CHANNELS) as [LeadChannel, (typeof CHANNELS)[LeadChannel]][]).map(
                    ([key, ch]) => ({ value: key, label: ch.short, icon: ch.icon }),
                  )}
                />
              </div>
            </div>
          )}

          <div className={cn("flex justify-end gap-2", !more && "pt-1")}>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              Crear contacto
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
