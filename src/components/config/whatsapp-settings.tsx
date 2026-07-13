"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, ChevronRight, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { updateAgency } from "@/lib/actions/settings";
import { fmtPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEBHOOK_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/wa-webhook`;

/** Miga de pan inline (reemplaza los "→" literales). */
function Crumb({ parts }: { parts: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5 align-baseline font-medium text-ink">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight className="size-3 shrink-0 text-ink-faint" aria-hidden />}
          {p}
        </React.Fragment>
      ))}
    </span>
  );
}

export function WhatsappSettings({
  initial,
}: {
  initial: {
    connected: boolean;
    display_number: string | null;
    phone_number_id: string | null;
  };
}) {
  const [displayNumber, setDisplayNumber] = React.useState(initial.display_number ?? "");
  const [phoneNumberId, setPhoneNumberId] = React.useState(initial.phone_number_id ?? "");
  const [saving, setSaving] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  async function save() {
    setSaving(true);
    const res = await updateAgency({
      settings: {
        whatsapp: {
          display_number: displayNumber.trim() || null,
          phone_number_id: phoneNumberId.trim() || null,
        },
      },
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Datos de WhatsApp guardados.");
  }

  function copyWebhook() {
    navigator.clipboard
      .writeText(WEBHOOK_URL)
      .then(() => {
        setCopied(true);
        toast.success("URL copiada.");
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast.error("No se pudo copiar. Copiala a mano."));
  }

  return (
    <div className="space-y-4">
      {/* Estado */}
      <section className="card p-5 animate-slide-up">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-1.5 size-3 shrink-0 rounded-full",
              initial.connected
                ? "bg-wa-accent ring-4 ring-wa-accent/15 animate-pulse-dot"
                : "bg-stone-400 ring-4 ring-tone-stone-soft",
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            {initial.connected ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-lg font-semibold text-ink">Conectado</h2>
                  {initial.display_number && (
                    <span className="rounded-full border border-tone-emerald-line bg-tone-emerald-soft px-2.5 py-0.5 text-[12px] font-medium text-tone-emerald-text tabular-nums">
                      {fmtPhone(initial.display_number)}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-ink-soft">
                  Los mensajes entran y salen solos por la Cloud API de Meta.
                </p>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-lg font-semibold text-ink">No conectado</h2>
                  <span className="rounded-full border border-tone-stone-line bg-tone-stone-soft px-2.5 py-0.5 text-[12px] font-medium text-tone-stone-text">
                    Sin Cloud API
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-ink-soft">
                  Los mensajes se registran en el sistema y podés seguir operando; para enviar y
                  recibir automáticamente, conectá la Cloud API de Meta con los pasos de abajo.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="wa-number">Número de WhatsApp</Label>
            <Input
              id="wa-number"
              value={displayNumber}
              onChange={(e) => setDisplayNumber(e.target.value)}
              placeholder="+54 9 351 555-0000"
              inputMode="tel"
              maxLength={40}
            />
            <p className="mt-1.5 text-xs text-ink-faint">El número que ven tus clientes.</p>
          </div>
          <div>
            <Label htmlFor="wa-pnid">Phone number ID</Label>
            <Input
              id="wa-pnid"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="1234567890123456"
              maxLength={80}
              className="font-mono text-[13px]"
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              Lo encontrás en <Crumb parts={["Meta for Developers", "WhatsApp", "API Setup"]} />.
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={save} loading={saving}>
            Guardar
          </Button>
        </div>
      </section>

      {/* Webhook */}
      <section className="card p-5 animate-fade-in">
        <h2 className="font-display text-lg font-semibold text-ink">Webhook</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          Es la puerta por donde entran los mensajes de tus clientes al sistema.
        </p>

        <div className="mt-4 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-xl border border-line bg-sand-soft/60 px-3.5 py-2.5 font-mono text-[12px] text-ink-soft">
            {WEBHOOK_URL}
          </code>
          <Button size="icon" variant="secondary" onClick={copyWebhook} aria-label="Copiar URL del webhook">
            {copied ? <Check className="text-money-700 animate-check-pop" /> : <Copy />}
          </Button>
        </div>

        <ol className="mt-5 space-y-3 stagger-children">
          {[
            <React.Fragment key="s1">
              Entrá a{" "}
              <a
                href="https://developers.facebook.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-600 hover:underline"
              >
                developers.facebook.com
              </a>{" "}
              y abrí tu app.
            </React.Fragment>,
            <React.Fragment key="s2">
              Andá a <Crumb parts={["WhatsApp", "Configuration"]} />.
            </React.Fragment>,
            <React.Fragment key="s3">
              En <span className="font-medium text-ink">Webhook</span>, pegá la URL de arriba y el
              verify token que te dio soporte al activar la integración.
            </React.Fragment>,
            <React.Fragment key="s4">
              Suscribite al campo{" "}
              <code className="rounded bg-sand-soft px-1 py-0.5 font-mono text-[12px]">messages</code>{" "}
              y guardá.
            </React.Fragment>,
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-cream">
                {i + 1}
              </span>
              <p className="text-sm leading-relaxed text-ink-soft">{step}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
