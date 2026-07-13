"use client";

import * as React from "react";
import { toast } from "sonner";
import { ImagePlus, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { updateAgency } from "@/lib/actions/settings";
import { QUOTE_COLORS, QUOTE_FONTS } from "@/lib/domain";
import { cn } from "@/lib/utils";

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
  };
}) {
  const [name, setName] = React.useState(initial.name);
  const [phone, setPhone] = React.useState(initial.phone ?? "");
  const [email, setEmail] = React.useState(initial.email ?? "");
  const [address, setAddress] = React.useState(initial.address ?? "");
  const [usdRate, setUsdRate] = React.useState(initial.usd_rate != null ? String(initial.usd_rate) : "");
  const [themeColor, setThemeColor] = React.useState(initial.quote_theme.color);
  const [themeFont, setThemeFont] = React.useState(initial.quote_theme.font);
  const [logoUrl, setLogoUrl] = React.useState(initial.logo_url);
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

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
    setSaving(true);
    const res = await updateAgency({
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      settings: {
        usd_rate: rate,
        quote_theme: { color: themeColor, font: themeFont },
      },
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Datos de la agencia guardados.");
  }

  return (
    <div className="space-y-4">
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

      {/* Logo */}
      <section className="card p-5 animate-slide-up">
        <h2 className="font-display text-lg font-semibold text-ink">Logo</h2>
        <p className="mt-0.5 text-sm text-ink-faint">Se muestra arriba de tus presupuestos compartidos.</p>

        <div className="mt-4 flex items-center gap-4">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Logo de la agencia"
              className="size-20 shrink-0 rounded-2xl border border-line bg-paper object-contain p-2"
            />
          ) : (
            <div className="flex size-20 shrink-0 items-center justify-center rounded-2xl border border-dashed border-line-strong text-ink-faint">
              <ImagePlus className="size-6" />
            </div>
          )}
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
              <Button variant="ghost" onClick={removeLogo}>
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
                  <Check className="size-4 animate-pop" style={{ color: c.accent }} strokeWidth={3} />
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

      <div className="flex justify-end">
        <Button onClick={save} loading={saving} size="lg" className="w-full sm:w-auto">
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}
