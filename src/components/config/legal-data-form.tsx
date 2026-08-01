"use client";

import * as React from "react";
import { toast } from "sonner";
import { ExternalLink, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { updateAgency } from "@/lib/actions/settings";

/**
 * Datos registrales de la sociedad. Son los que pide Meta para verificar el
 * negocio, los que pide ARCA y los que van al pie de los comprobantes.
 *
 * Están separados de la tarjeta de Agencia a propósito: ahí se cargan el nombre
 * y la dirección COMERCIALES (lo que ve el cliente), que rara vez coinciden con
 * los del estatuto. Mezclarlos hace que alguien "corrija" la razón social por el
 * nombre de fantasía y se caiga una verificación.
 *
 * Se publican en /empresa, que es una página sin login: cuando un tercero
 * (Meta, un proveedor, un mayorista) pide corroborar los datos, se le pasa ese
 * link en vez de mandar capturas.
 */

export type LegalData = {
  legal_name: string;
  cuit: string;
  address: string;
  city: string;
  province: string;
  postal_code: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  evyt: string;
};

/**
 * `max` espeja EXACTO el tope del zod de `updateAgency` (settings.ts). Si el
 * input dejara escribir de más, el server rechaza el patch entero con un error
 * genérico que no nombra el campo, y con once inputs cargados no hay forma de
 * saber cuál lo está trabando.
 */
const FIELDS: {
  key: keyof LegalData;
  label: string;
  placeholder: string;
  max: number;
  hint?: string;
  wide?: boolean;
  mono?: boolean;
  type?: string;
  inputMode?: React.ComponentProps<"input">["inputMode"];
}[] = [
  {
    key: "legal_name",
    label: "Razón social",
    placeholder: "TURISMO Y VIAJES PARA TODOS S.A.S.",
    hint: "Exacta como figura en el estatuto, con el tipo societario incluido.",
    max: 160,
    wide: true,
  },
  { key: "cuit", label: "CUIT", placeholder: "30-12345678-9", max: 20, mono: true, inputMode: "tel" },
  { key: "evyt", label: "Legajo EVyT", placeholder: "16.123", max: 40, mono: true },
  {
    key: "address",
    label: "Domicilio de la sede social",
    placeholder: "Vélez Sarsfield 571, Barrio Centro",
    hint: "El del instrumento constitutivo, no el del local.",
    max: 200,
    wide: true,
  },
  { key: "city", label: "Ciudad", placeholder: "La Carlota", max: 80 },
  { key: "province", label: "Provincia", placeholder: "Córdoba", max: 80 },
  { key: "postal_code", label: "Código postal", placeholder: "2670", max: 20, mono: true },
  { key: "country", label: "País", placeholder: "Argentina", max: 80 },
  {
    key: "phone",
    label: "Teléfono",
    placeholder: "+54 9 351 514 6768",
    hint: "El que figura en los papeles; puede no ser el de WhatsApp.",
    max: 40,
    inputMode: "tel",
  },
  { key: "email", label: "Email", placeholder: "hola@tuagencia.com", max: 160, type: "email" },
  {
    key: "website",
    label: "Sitio web",
    placeholder: "https://tuagencia.com",
    max: 200,
    inputMode: "url",
    wide: true,
  },
];

export function LegalDataForm({
  initial,
  isAdmin,
  slug,
}: {
  initial: LegalData;
  isAdmin: boolean;
  /** el de la agencia: la ficha pública va scopeada por slug, no por "la primera" */
  slug: string;
}) {
  const [values, setValues] = React.useState<LegalData>(initial);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState<LegalData>(initial);

  const dirty = (Object.keys(values) as (keyof LegalData)[]).some(
    (k) => values[k].trim() !== saved[k].trim(),
  );

  function set(key: keyof LegalData, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function save() {
    setSaving(true);
    const payload = Object.fromEntries(
      (Object.keys(values) as (keyof LegalData)[]).map((k) => [k, values[k].trim() || null]),
    );
    const res = await updateAgency({ settings: { legal: payload } });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setSaved(values);
    toast.success("Datos de la empresa guardados.");
  }

  return (
    <section className="card mt-4 p-5 animate-fade-in">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text">
          <Landmark className="size-4.5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold text-ink">Datos de la empresa</h2>
          <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">
            Los que piden Meta para verificar el negocio, ARCA y los que van al pie de los
            comprobantes. Cargalos una vez y se copian de{" "}
            <a
              href={`/empresa/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
            >
              tu página pública
              <ExternalLink className="size-3.5" aria-hidden />
            </a>{" "}
            cada vez que alguien te los pida.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.wide ? "sm:col-span-2" : undefined}>
            <Label htmlFor={`legal-${f.key}`}>{f.label}</Label>
            <Input
              id={`legal-${f.key}`}
              value={values[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={f.placeholder}
              disabled={!isAdmin}
              maxLength={f.max}
              type={f.type}
              inputMode={f.inputMode}
              className={f.mono ? "font-mono text-[13px]" : undefined}
            />
            {f.hint && <p className="mt-1.5 text-xs text-ink-faint">{f.hint}</p>}
          </div>
        ))}
      </div>

      {isAdmin ? (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} loading={saving} disabled={!dirty}>
            Guardar
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-ink-faint">
          Estos datos los edita un admin de la agencia.
        </p>
      )}
    </section>
  );
}
