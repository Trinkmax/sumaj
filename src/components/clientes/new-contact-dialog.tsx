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
import { findContactByPhone } from "@/lib/actions/leads";
import { cn } from "@/lib/utils";
import type { LeadChannel } from "@/lib/types";

/** Lo que devuelve `findContactByPhone`: el contacto de la agencia con ese teléfono. */
type ExistingContact = { id: string; fullName: string };

/* Espera después de la última tecla antes de preguntarle al servidor: el
   teléfono se escribe de a un dígito y no tiene sentido consultar diez veces. */
const LOOKUP_DEBOUNCE_MS = 350;

/**
 * Alta rápida de contacto. El dedupe por teléfono se pregunta al servidor
 * (`findContactByPhone` → RPC `find_contact_by_phone`, que mira TODA la
 * agencia) y no contra la lista de la página: el freelance ya no tiene la base
 * entera, así que compararlo contra lo que ve dejaría pasar duplicados de los
 * contactos de los demás.
 */
export function NewContactButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [more, setMore] = React.useState(false);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [city, setCity] = React.useState("");
  const [source, setSource] = React.useState<LeadChannel>("manual");

  /* Teléfono listo para consultar ("" = todavía muy corto para preguntar).
     El umbral es el mismo que exige el servidor (`findContactByPhone` y la RPC
     `find_contact_by_phone` cortan en 8 dígitos ya normalizados): preguntar
     antes es un viaje al servidor que vuelve vacío sí o sí, y el mismo número
     que usa new-lead-dialog. */
  const lookupPhone = React.useMemo(() => {
    const normalized = normalizePhone(phone);
    return normalized.length < 8 ? "" : normalized;
  }, [phone]);

  /* La respuesta se guarda junto con el teléfono que la produjo: si el número
     cambió mientras viajaba la consulta, el resultado viejo no se muestra
     (y así el efecto no necesita un setState sincrónico para "limpiar"). */
  const [lookup, setLookup] = React.useState<{
    phone: string;
    match: ExistingContact | null;
  } | null>(null);

  React.useEffect(() => {
    if (!lookupPhone) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await findContactByPhone({ phone: lookupPhone });
      if (cancelled) return;
      setLookup({ phone: lookupPhone, match: res.ok ? res.data : null });
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lookupPhone]);

  const duplicate = lookup && lookup.phone === lookupPhone ? lookup.match : null;

  const reset = () => {
    setName("");
    setPhone("");
    setEmail("");
    setCity("");
    setSource("manual");
    setMore(false);
    setLookup(null);
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
                  Ya existe:{" "}
                  <Link
                    href={`/clientes/${duplicate.id}`}
                    className="font-semibold underline underline-offset-2"
                    onClick={() => setOpen(false)}
                  >
                    {duplicate.fullName}
                  </Link>{" "}
                  con el teléfono {fmtPhone(lookupPhone)}. Fijate que no sea la misma persona.
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
