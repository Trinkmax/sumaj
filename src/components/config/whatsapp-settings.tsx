"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bot,
  Check,
  CheckCheck,
  ChevronRight,
  Copy,
  KeyRound,
  Megaphone,
  MessageSquareReply,
  Plus,
  Smartphone,
  Store,
  TriangleAlert,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { EmptyState, Switch } from "@/components/ui/misc";
import { createMotherChannel, updateChannelSettings } from "@/lib/actions/branches";
import { fmtPhone, fmtRelative } from "@/lib/format";
import type { Enums } from "@/lib/types";
import { cn } from "@/lib/utils";

const AUTO_REPLY_MAX = 1000;
const WEBHOOK_PATH = "/api/wa/cloud/webhook";

/** solo dígitos: el server guarda así el teléfono, comparamos con la misma vara */
const digits = (s: string) => s.replace(/\D/g, "");

/* Origen del navegador para armar la URL del webhook cuando falta la env.
   Con useSyncExternalStore el server rinde null y el cliente completa después
   de hidratar: sin mismatch y sin setState dentro de un efecto. */
const subscribeOrigin = () => () => {};
const clientOrigin = (): string | null => window.location.origin;
const serverOrigin = (): string | null => null;

export type MotherChannel = {
  id: string;
  label: string;
  phone: string | null;
  phoneNumberId: string | null;
  status: Enums<"wa_channel_status">;
  autoReplyEnabled: boolean;
  autoReplyText: string;
  lastConnectedAt: string | null;
  lastError: string | null;
};

/**
 * "listo" no vive en la base: nada marca el número madre como conectado (eso lo
 * define Meta del otro lado). Cuando ya están el phone number ID y la Cloud API
 * del servidor, mostrar "No conectado" sería mentir.
 */
type StatusView = Enums<"wa_channel_status"> | "listo";

const STATUS_META: Record<
  StatusView,
  { label: string; chip: string; dot: string; hint: string }
> = {
  conectado: {
    label: "Conectado",
    chip: "border-tone-emerald-line bg-tone-emerald-soft text-tone-emerald-text",
    dot: "bg-wa-accent ring-4 ring-wa-accent/15 animate-pulse-dot",
    hint: "Las consultas nuevas entran solas y el sistema contesta al toque.",
  },
  listo: {
    label: "Listo para recibir",
    chip: "border-tone-emerald-line bg-tone-emerald-soft text-tone-emerald-text",
    dot: "bg-wa-accent ring-4 ring-wa-accent/15 animate-pulse-dot",
    hint: "Están cargados el número y la Cloud API. Terminá el webhook en Meta y la primera consulta te aparece en el CRM.",
  },
  vinculando: {
    label: "Vinculando",
    chip: "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
    dot: "bg-amber-500 ring-4 ring-tone-amber-soft",
    hint: "Estamos terminando de conectar el número. En un rato refrescá la página.",
  },
  desconectado: {
    label: "No conectado",
    chip: "border-tone-stone-line bg-tone-stone-soft text-tone-stone-text",
    dot: "bg-stone-400 ring-4 ring-tone-stone-soft",
    hint: "Cargá los datos de abajo y configurá el webhook para que las consultas entren solas.",
  },
  error: {
    label: "Con error",
    chip: "border-tone-red-line bg-tone-red-soft text-tone-red-text",
    dot: "bg-red-500 ring-4 ring-tone-red-soft",
    hint: "Meta rechazó la última llamada. Revisá el phone number ID y el token del servidor.",
  },
};

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Megaphone,
    title: "Todo entra por este número",
    body: "Los anuncios, la web y el WhatsApp que ve el público apuntan acá. Cualquier consulta nueva cae en el número madre, venga de donde venga.",
  },
  {
    icon: MessageSquareReply,
    title: "El sistema contesta solo y avisa",
    body: "Le responde al cliente en el acto, crea el lead y lo deriva a la sucursal que corresponde según las reglas de abajo. Los operadores reciben el aviso en la app y en su WhatsApp.",
  },
  {
    icon: Store,
    title: "El seguimiento sigue por la sucursal",
    body: "El operador le escribe desde el número de su sucursal, que es un WhatsApp común: sin ventana de 24 hs y sin pagar plantillas.",
  },
];

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

function HowItWorks() {
  return (
    <section className="card p-5 animate-slide-up">
      <h2 className="font-display text-lg font-semibold text-ink">Cómo funciona</h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        El número madre atiende la puerta; la sucursal hace el viaje.
      </p>

      <ol className="mt-4 space-y-3.5 stagger-children">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex items-start gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-cream tabular-nums">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <step.icon className="size-4 shrink-0 text-brand-text" strokeWidth={1.9} />
                {step.title}
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function WhatsappSettings({
  channel,
  cloudApiReady,
  webhookBase,
  isAdmin,
}: {
  channel: MotherChannel | null;
  cloudApiReady: boolean;
  /** base pública (NEXT_PUBLIC_APP_URL). Si falta, la resolvemos en el navegador. */
  webhookBase: string | null;
  isAdmin: boolean;
}) {
  const [phone, setPhone] = React.useState(channel?.phone ?? "");
  const [phoneNumberId, setPhoneNumberId] = React.useState(channel?.phoneNumberId ?? "");
  const [autoOn, setAutoOn] = React.useState(channel?.autoReplyEnabled ?? true);
  const [autoText, setAutoText] = React.useState(channel?.autoReplyText ?? "");
  const [savingNumber, setSavingNumber] = React.useState(false);
  const [savingReply, setSavingReply] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copyTimer = React.useRef<number | null>(null);
  const router = useRouter();
  const origin = React.useSyncExternalStore<string | null>(
    subscribeOrigin,
    clientOrigin,
    serverOrigin,
  );

  React.useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const base = webhookBase ?? origin;
  const webhookUrl = base ? `${base}${WEBHOOK_PATH}` : null;

  async function createMother() {
    setCreating(true);
    const res = await createMotherChannel();
    setCreating(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Número madre listo. Cargale el número y el phone number ID.");
    router.refresh();
  }

  if (!channel) {
    return (
      <div className="space-y-4">
        <HowItWorks />
        <EmptyState
          icon={Smartphone}
          title="Todavía no hay número madre"
          description={
            isAdmin
              ? "Crealo acá y después le cargás el número y los datos de Meta. Hasta entonces las consultas nuevas no tienen por dónde entrar."
              : "Lo tiene que crear un admin de la agencia. Mientras tanto los leads se cargan a mano y se contesta desde el número de cada sucursal."
          }
          action={
            isAdmin ? (
              <Button onClick={createMother} loading={creating}>
                <Plus />
                Crear el número madre
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  // binding const: mantiene el estrechamiento dentro de los handlers
  const ch = channel;
  const view: StatusView =
    channel.status === "desconectado" && cloudApiReady && Boolean(channel.phoneNumberId)
      ? "listo"
      : channel.status;
  const status = STATUS_META[view] ?? STATUS_META.desconectado;
  // el server normaliza el teléfono a dígitos: si comparáramos el texto crudo,
  // el botón Guardar quedaba habilitado para siempre después de guardar
  const numberDirty =
    digits(phone) !== digits(channel.phone ?? "") ||
    phoneNumberId.trim() !== (channel.phoneNumberId ?? "");
  const replyDirty = autoText.trim() !== (channel.autoReplyText ?? "").trim();
  const overLimit = autoText.length > AUTO_REPLY_MAX;

  async function saveNumber() {
    if (phone.trim() && digits(phone).length < 8) {
      toast.error("Ese número quedó corto. Escribilo con característica, sin el 0 ni el 15.");
      return;
    }
    setSavingNumber(true);
    const res = await updateChannelSettings({
      channelId: ch.id,
      phone: phone.trim() || null,
      phoneNumberId: phoneNumberId.trim() || null,
    });
    setSavingNumber(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Datos del número madre guardados.");
  }

  async function toggleAuto(next: boolean) {
    setAutoOn(next); // optimista
    const res = await updateChannelSettings({ channelId: ch.id, autoReplyEnabled: next });
    if (!res.ok) {
      setAutoOn(!next);
      toast.error(res.error);
      return;
    }
    toast.success(next ? "Respuesta automática activada." : "Respuesta automática apagada.");
  }

  async function saveReply() {
    if (overLimit) {
      toast.error(`El mensaje es muy largo. Dejalo en ${AUTO_REPLY_MAX} caracteres o menos.`);
      return;
    }
    setSavingReply(true);
    const res = await updateChannelSettings({
      channelId: ch.id,
      autoReplyText: autoText.trim() || null,
    });
    setSavingReply(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Respuesta automática guardada.");
  }

  async function copyWebhook() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      toast.success("URL copiada.");
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar. Copiala a mano.");
    }
  }

  return (
    <div className="space-y-4">
      <HowItWorks />

      {!cloudApiReady && (
        <div className="flex items-start gap-3 rounded-2xl border border-tone-amber-line bg-tone-amber-soft px-4 py-3.5 animate-fade-in">
          <TriangleAlert className="mt-0.5 size-4.5 shrink-0 text-tone-amber-text" strokeWidth={1.9} />
          <p className="text-sm leading-relaxed text-tone-amber-text">
            Todavía falta configurar la Cloud API en el servidor. Hasta que esté, las consultas no
            van a entrar solas por este número: podés seguir cargando leads a mano y contestando
            desde el número de cada sucursal.
          </p>
        </div>
      )}

      {/* Estado del número madre */}
      <section className="card p-5 animate-fade-in">
        <div className="flex items-start gap-3">
          <span className={cn("mt-1.5 size-3 shrink-0 rounded-full", status.dot)} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-semibold text-ink">{status.label}</h2>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[12px] font-medium tabular-nums",
                  status.chip,
                )}
              >
                {channel.phone ? fmtPhone(channel.phone) : "Sin número cargado"}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-ink-soft">{status.hint}</p>
            {channel.lastConnectedAt && (
              <p className="mt-1 text-xs text-ink-faint">
                Última conexión {fmtRelative(channel.lastConnectedAt)}.
              </p>
            )}
          </div>
        </div>

        {channel.status === "error" && channel.lastError && (
          <p className="mt-4 rounded-xl border border-tone-red-line bg-tone-red-soft px-3.5 py-2.5 text-[13px] text-tone-red-text">
            {channel.lastError}
          </p>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="wa-number">Número de WhatsApp</Label>
            <Input
              id="wa-number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+54 9 351 555-0000"
              inputMode="tel"
              maxLength={40}
              disabled={!isAdmin}
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
              disabled={!isAdmin}
              className="font-mono text-[13px]"
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              Lo encontrás en <Crumb parts={["Meta for Developers", "WhatsApp", "API Setup"]} />.
            </p>
          </div>
        </div>

        {isAdmin ? (
          <div className="mt-4 flex justify-end">
            <Button onClick={saveNumber} loading={savingNumber} disabled={!numberDirty}>
              Guardar
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-xs text-ink-faint">
            La conexión la maneja un admin de la agencia.
          </p>
        )}
      </section>

      {/* Respuesta automática */}
      <section className="card p-5 animate-fade-in">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-ink">Respuesta automática</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              Es lo primero que lee el cliente, así que conviene que le diga que un asesor lo va a
              contactar en un rato.
            </p>
          </div>
          <Switch
            checked={autoOn}
            onCheckedChange={toggleAuto}
            disabled={!isAdmin}
            aria-label="Activar la respuesta automática"
          />
        </div>

        {/* el texto se edita aunque esté apagada (se deja listo y después se prende),
            así que no lo atenuamos: bajar el contraste de un campo usable confunde */}
        <div className="mt-4">
          <Label htmlFor="wa-auto">Mensaje</Label>
          <Textarea
            id="wa-auto"
            value={autoText}
            onChange={(e) => setAutoText(e.target.value)}
            placeholder="¡Hola! Gracias por escribirnos. En un ratito te contacta un asesor."
            rows={4}
            disabled={!isAdmin}
            className="min-h-[104px]"
          />
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <p className="text-xs text-ink-faint">
              {autoOn
                ? "Sale solo la primera vez que alguien escribe al número madre."
                : "Está apagada: podés dejar el texto listo y prenderla cuando quieras."}
            </p>
            <span
              className={cn(
                "shrink-0 text-xs tabular-nums",
                overLimit ? "font-medium text-tone-red-text" : "text-ink-faint",
              )}
            >
              {autoText.length}/{AUTO_REPLY_MAX}
            </span>
          </div>

          {/* Preview: así lo ve el cliente en su WhatsApp */}
          <p className="mb-1.5 mt-4 text-[13px] font-medium text-ink-soft">Así lo ve el cliente</p>
          <div
            className={cn(
              "rounded-2xl border border-line p-3 transition-opacity wa-wallpaper",
              !autoOn && "opacity-60",
            )}
          >
            <div className="flex justify-end">
              <div className="relative max-w-[85%] rounded-lg rounded-tr-none bg-wa-bubble-out px-[9px] py-[6px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] bubble-tail-out">
                <p className="whitespace-pre-wrap break-words text-[14px] leading-snug text-wa-bubble-ink">
                  {autoText.trim() || "Escribí el mensaje que le va a llegar al cliente."}
                  <span className="float-right ml-2 mt-[7px] inline-flex items-center gap-1 align-bottom text-[11px] leading-none text-wa-bubble-meta">
                    <Bot className="size-3" aria-hidden />
                    Automático
                    <CheckCheck className="size-4 text-wa-tick" aria-hidden />
                  </span>
                </p>
              </div>
            </div>
          </div>

          {isAdmin && (
            <div className="mt-4 flex justify-end">
              <Button onClick={saveReply} loading={savingReply} disabled={!replyDirty}>
                Guardar respuesta
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Webhook */}
      <section className="card p-5 animate-fade-in">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text">
            <Webhook className="size-4.5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-ink">Webhook</h2>
            <p className="text-sm text-ink-soft">
              Es la puerta por donde Meta le pasa al sistema los mensajes de tus clientes.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-xl border border-line bg-sand-soft/60 px-3.5 py-2.5 font-mono text-[12px] text-ink-soft">
            {webhookUrl ?? WEBHOOK_PATH}
          </code>
          <Button
            size="icon"
            variant="secondary"
            onClick={copyWebhook}
            disabled={!webhookUrl}
            aria-label="Copiar URL del webhook"
            className="size-11 sm:size-9"
          >
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
              En <span className="font-medium text-ink">Webhook</span>, pegá la URL de arriba y como
              verify token el valor de{" "}
              <code className="rounded bg-sand-soft px-1 py-0.5 font-mono text-[12px]">
                WA_CLOUD_VERIFY_TOKEN
              </code>{" "}
              del servidor.
            </React.Fragment>,
            <React.Fragment key="s4">
              Suscribite al campo{" "}
              <code className="rounded bg-sand-soft px-1 py-0.5 font-mono text-[12px]">messages</code>{" "}
              y guardá.
            </React.Fragment>,
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-cream tabular-nums">
                {i + 1}
              </span>
              <p className="text-sm leading-relaxed text-ink-soft">{step}</p>
            </li>
          ))}
        </ol>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-sand-soft/60 px-3.5 py-2.5">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-ink-faint" strokeWidth={1.9} />
          <p className="text-xs leading-relaxed text-ink-soft">
            El token de acceso permanente de Meta va en la variable{" "}
            <code className="rounded bg-paper px-1 py-0.5 font-mono text-[11px]">WA_CLOUD_TOKEN</code>{" "}
            del servidor. Nunca se carga desde acá.
          </p>
        </div>
      </section>
    </div>
  );
}
