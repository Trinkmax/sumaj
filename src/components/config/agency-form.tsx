"use client";

import * as React from "react";
import { toast } from "sonner";
import { Calculator, Check, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { updateAgency } from "@/lib/actions/settings";
import { QUOTE_COLORS, QUOTE_FONTS, finalFromGross } from "@/lib/domain";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "2,5" → 2.5 · null si no es un porcentaje válido (0 a 100). */
function pct(value: string): number | null {
  const n = Number(value.trim().replace(",", "."));
  if (value.trim() === "" || isNaN(n) || n < 0 || n > 100) return null;
  return n;
}

/** Bruto de referencia para el ejemplo del cotizador. */
const EXAMPLE_GROSS = 1000;

type Snapshot = {
  name: string;
  phone: string;
  email: string;
  address: string;
  usdRate: string;
  themeColor: string;
  themeFont: string;
  feeAereo: string;
  feeTerrestre: string;
  sellerPct: string;
};

export function AgencyForm({
  agencyId,
  initial,
}: {
  agencyId: string;
  initial: {
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    logo_url: string | null;
    usd_rate: number | null;
    quote_theme: { color: string; font: string };
    quote_fees: { aereo_pct: number; terrestre_pct: number };
    quote_seller_commission_pct: number;
  };
}) {
  const [name, setName] = React.useState(initial.name);
  const [phone, setPhone] = React.useState(initial.phone ?? "");
  const [email, setEmail] = React.useState(initial.email ?? "");
  const [address, setAddress] = React.useState(initial.address ?? "");
  const [usdRate, setUsdRate] = React.useState(initial.usd_rate != null ? String(initial.usd_rate) : "");
  const [themeColor, setThemeColor] = React.useState(initial.quote_theme.color);
  const [themeFont, setThemeFont] = React.useState(initial.quote_theme.font);
  const [feeAereo, setFeeAereo] = React.useState(String(initial.quote_fees.aereo_pct));
  const [feeTerrestre, setFeeTerrestre] = React.useState(String(initial.quote_fees.terrestre_pct));
  const [sellerPct, setSellerPct] = React.useState(String(initial.quote_seller_commission_pct));
  const [logoUrl, setLogoUrl] = React.useState(initial.logo_url);
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // snapshot de lo último guardado: alimenta el indicador de cambios sin guardar
  const [savedSnap, setSavedSnap] = React.useState<Snapshot>({
    name: initial.name,
    phone: initial.phone ?? "",
    email: initial.email ?? "",
    address: initial.address ?? "",
    usdRate: initial.usd_rate != null ? String(initial.usd_rate) : "",
    themeColor: initial.quote_theme.color,
    themeFont: initial.quote_theme.font,
    feeAereo: String(initial.quote_fees.aereo_pct),
    feeTerrestre: String(initial.quote_fees.terrestre_pct),
    sellerPct: String(initial.quote_seller_commission_pct),
  });

  const dirty =
    name !== savedSnap.name ||
    phone !== savedSnap.phone ||
    email !== savedSnap.email ||
    address !== savedSnap.address ||
    usdRate !== savedSnap.usdRate ||
    themeColor !== savedSnap.themeColor ||
    themeFont !== savedSnap.themeFont ||
    feeAereo !== savedSnap.feeAereo ||
    feeTerrestre !== savedSnap.feeTerrestre ||
    sellerPct !== savedSnap.sellerPct;

  // ejemplo vivo del cotizador: se actualiza mientras tocan los fees
  const exampleFees = {
    aereo_pct: pct(feeAereo) ?? 0,
    terrestre_pct: pct(feeTerrestre) ?? 0,
  };

  async function handleLogo(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Elegí una imagen (PNG, JPG o similar).");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error("La imagen es muy pesada. Máximo 3 MB.");
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${agencyId}/logo.${ext}`;
    const { error } = await supabase.storage
      .from("logos")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) {
      setUploading(false);
      toast.error("No se pudo subir el logo. Probá de nuevo.");
      return;
    }
    const { data } = supabase.storage.from("logos").getPublicUrl(path);
    const url = `${data.publicUrl}?v=${Date.now()}`;
    const res = await updateAgency({ logo_url: url });
    setUploading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setLogoUrl(url);
    toast.success("Logo actualizado.");
  }

  async function removeLogo() {
    const prev = logoUrl;
    setLogoUrl(null); // optimista
    const res = await updateAgency({ logo_url: null });
    if (!res.ok) {
      setLogoUrl(prev);
      toast.error(res.error);
      return;
    }
    toast.success("Sacamos el logo.");
  }

  async function save() {
    if (name.trim().length < 2) {
      toast.error("Poné el nombre de la agencia.");
      return;
    }
    const rate = usdRate.trim() === "" ? null : Number(usdRate.replace(",", "."));
    if (rate !== null && (isNaN(rate) || rate <= 0)) {
      toast.error("La cotización del dólar tiene que ser un número mayor a 0.");
      return;
    }
    const aereo = pct(feeAereo);
    const terrestre = pct(feeTerrestre);
    const seller = pct(sellerPct);
    if (aereo === null || terrestre === null || seller === null) {
      toast.error("Los porcentajes del cotizador tienen que estar entre 0 y 100.");
      return;
    }
    setSaving(true);
    const res = await updateAgency({
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      settings: {
        usd_rate: rate,
        quote_theme: { color: themeColor, font: themeFont },
        quote_fees: { aereo_pct: aereo, terrestre_pct: terrestre },
        quote_seller_commission_pct: seller,
      },
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setSavedSnap({
      name,
      phone,
      email,
      address,
      usdRate,
      themeColor,
      themeFont,
      feeAereo,
      feeTerrestre,
      sellerPct,
    });
    toast.success("Datos de la agencia guardados.");
  }

  return (
    <div className="space-y-4 pb-2">
      {/* Datos básicos */}
      <section className="card p-5 animate-slide-up">
        <h2 className="font-display text-lg font-semibold text-ink">Datos de la agencia</h2>
        <p className="mt-0.5 text-sm text-ink-faint">
          Aparecen en los presupuestos y recibos que ven tus clientes.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="ag-name">Nombre</Label>
            <Input id="ag-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div>
            <Label htmlFor="ag-phone">Teléfono</Label>
            <Input
              id="ag-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+54 9 351 555-0000"
              inputMode="tel"
              maxLength={40}
            />
            <p className="mt-1.5 text-xs text-ink-faint">Aparece en presupuestos y recibos.</p>
          </div>
          <div>
            <Label htmlFor="ag-email">Email</Label>
            <Input
              id="ag-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="hola@tuagencia.com"
              maxLength={120}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ag-address">Dirección</Label>
            <Input
              id="ag-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Av. Colón 1234, Córdoba"
              maxLength={200}
            />
          </div>
          <div>
            <Label htmlFor="ag-usd">Cotización USD de referencia</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-faint">
                $
              </span>
              <Input
                id="ag-usd"
                value={usdRate}
                onChange={(e) => setUsdRate(e.target.value)}
                inputMode="decimal"
                placeholder="1200"
                className="pl-7 tabular-nums"
              />
            </div>
            <p className="mt-1.5 text-xs text-ink-faint">
              La usa Caja para convertir cobros en pesos a dólares.
            </p>
          </div>
        </div>
      </section>

      {/* Cotizador */}
      <section className="card p-5 animate-slide-up">
        <h2 className="font-display text-lg font-semibold text-ink">Cotizador</h2>
        <p className="mt-0.5 text-sm text-ink-faint">
          Cargás el bruto de cada servicio y el sistema calcula el final con estos números.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <PctField
            id="ag-fee-aereo"
            label="Fee aéreo"
            value={feeAereo}
            onChange={setFeeAereo}
            hint="Al bruto de los aéreos se le suma este % para llegar al final."
          />
          <PctField
            id="ag-fee-terrestre"
            label="Fee terrestre"
            value={feeTerrestre}
            onChange={setFeeTerrestre}
            hint="Idem para hotelería y demás terrestres."
          />
          <PctField
            id="ag-seller-pct"
            label="Comisión del vendedor"
            value={sellerPct}
            onChange={setSellerPct}
            hint="Del markup de cada presupuesto, esto es lo que se lleva el vendedor."
            className="sm:col-span-2"
          />
        </div>

        <p className="mt-4 flex items-start gap-2 rounded-xl bg-sand-soft px-3.5 py-2.5 text-xs leading-relaxed text-ink-soft">
          <Calculator className="mt-px size-3.5 shrink-0 text-ink-faint" strokeWidth={1.9} />
          <span>
            Un aéreo de {fmtMoney(EXAMPLE_GROSS)} bruto sale{" "}
            <span className="font-medium tabular-nums text-ink">
              {fmtMoney(finalFromGross(EXAMPLE_GROSS, "aereo", exampleFees))}
            </span>{" "}
            · un terrestre igual sale{" "}
            <span className="font-medium tabular-nums text-ink">
              {fmtMoney(finalFromGross(EXAMPLE_GROSS, "hotel", exampleFees))}
            </span>
            .
          </span>
        </p>
      </section>

      {/* Logo */}
      <section className="card p-5 animate-slide-up">
        <h2 className="font-display text-lg font-semibold text-ink">Logo</h2>
        <p className="mt-0.5 text-sm text-ink-faint">Se muestra arriba de tus presupuestos compartidos.</p>

        <div className="mt-4 flex items-center gap-4">
          <div className="relative size-20 shrink-0">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt="Logo de la agencia"
                className="size-20 rounded-2xl border border-line bg-paper object-contain p-2"
              />
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Subir logo"
                className="flex size-20 items-center justify-center rounded-2xl border border-dashed border-line-strong text-ink-faint transition-colors hover:border-brand-400 hover:text-brand-600 tap-highlight-none"
              >
                <ImagePlus className="size-6" strokeWidth={1.75} />
              </button>
            )}
            {uploading && (
              <span className="absolute inset-0 grid place-items-center rounded-2xl bg-overlay animate-fade-in">
                <Loader2 className="size-5 animate-spin text-white" />
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleLogo(f);
                e.target.value = "";
              }}
            />
            <Button variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
              {!uploading && <ImagePlus />}
              {logoUrl ? "Cambiar logo" : "Subir logo"}
            </Button>
            {logoUrl && (
              <Button variant="ghost" onClick={removeLogo} disabled={uploading}>
                <Trash2 />
                Quitar
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Tema de presupuestos */}
      <section className="card p-5 animate-slide-up">
        <h2 className="font-display text-lg font-semibold text-ink">Tema de presupuestos</h2>
        <p className="mt-0.5 text-sm text-ink-faint">
          El estilo con el que salen tus presupuestos por defecto. Cada uno se puede cambiar al cotizar.
        </p>

        <div className="mt-4">
          <Label>Color</Label>
          <div className="flex flex-wrap gap-2.5">
            {QUOTE_COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setThemeColor(c.key)}
                title={c.label}
                aria-label={`Tema ${c.label}`}
                aria-pressed={themeColor === c.key}
                className={cn(
                  "relative flex size-11 items-center justify-center rounded-full border transition-all tap-highlight-none active:scale-95",
                  themeColor === c.key
                    ? "border-ink ring-2 ring-ink/15 scale-105"
                    : "border-line hover:border-line-strong",
                )}
                style={{ backgroundColor: c.swatch }}
              >
                {themeColor === c.key && (
                  <Check className="size-4 animate-check-pop" style={{ color: c.accent }} strokeWidth={3} />
                )}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-faint">
            {QUOTE_COLORS.find((c) => c.key === themeColor)?.label}
          </p>
        </div>

        <div className="mt-4">
          <Label>Tipografía</Label>
          <div className="flex flex-wrap gap-2">
            {QUOTE_FONTS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setThemeFont(f.key)}
                aria-pressed={themeFont === f.key}
                className={cn(
                  "rounded-xl border px-4 py-2.5 text-[15px] transition-all tap-highlight-none active:scale-[0.98]",
                  themeFont === f.key
                    ? "border-ink bg-ink text-cream shadow-sm"
                    : "border-line bg-paper text-ink-soft hover:border-line-strong",
                )}
                style={{ fontFamily: f.css }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
        {dirty && (
          <span className="flex items-center justify-center gap-1.5 text-[13px] text-ink-faint animate-fade-in sm:justify-end">
            <span className="size-1.5 rounded-full bg-amber-500 animate-pulse-dot" aria-hidden />
            Tenés cambios sin guardar
          </span>
        )}
        <Button
          onClick={save}
          loading={saving}
          disabled={!dirty && !saving}
          size="lg"
          className="w-full sm:w-auto"
        >
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}

/* ── Campo de porcentaje con sufijo y explicación en criollo ── */

function PctField({
  id,
  label,
  value,
  onChange,
  hint,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint: string;
  className?: string;
}) {
  const invalid = pct(value) === null;

  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          placeholder="0"
          aria-invalid={invalid}
          aria-describedby={`${id}-hint`}
          className={cn("h-11 pr-8 text-right tabular-nums", invalid && "border-tone-red-line")}
        />
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-faint">
          %
        </span>
      </div>
      <p
        id={`${id}-hint`}
        className={cn("mt-1.5 text-xs", invalid ? "text-tone-red-text" : "text-ink-faint")}
      >
        {invalid ? "Poné un número entre 0 y 100." : hint}
      </p>
    </div>
  );
}
