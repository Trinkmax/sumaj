"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bot,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  ListChecks,
  Lock,
  Megaphone,
  MessageSquareReply,
  Plus,
  PlugZap,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Store,
  TriangleAlert,
  Unplug,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { EmptyState, Switch } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/config/confirm-dialog";
import { createMotherChannel, updateChannelSettings } from "@/lib/actions/branches";
import {
  connectCloud,
  disconnectCloud,
  registerMotherNumber,
  revealVerifyToken,
  runCloudDiagnostics,
  saveCloudCredentials,
  selectCloudNumber,
  type CloudCheck,
  type CloudStatus,
} from "@/lib/actions/wa-cloud";
import type { CloudPhoneNumber } from "@/lib/wa/cloud";
import { WEBHOOK_BASE_PATH } from "@/lib/wa/routes";
import { fmtPhone, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const AUTO_REPLY_MAX = 1000;

/* Origen del navegador para armar la URL del webhook cuando falta la env.
   Con useSyncExternalStore el server rinde null y el cliente completa después
   de hidratar: sin mismatch y sin setState dentro de un efecto. */
const subscribeOrigin = () => () => {};
const clientOrigin = (): string | null => window.location.origin;
const serverOrigin = (): string | null => null;

export type MotherChannel = {
  id: string;
  phone: string | null;
  autoReplyEnabled: boolean;
  autoReplyText: string;
};

/* ═══════════════════════════════════════════════════════════
   Cómo funciona (no se toca: es el mapa mental del negocio)
   ═══════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════
   Piezas chicas
   ═══════════════════════════════════════════════════════════ */

async function copyToClipboard(text: string, okMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMessage);
    return true;
  } catch {
    toast.error("No se pudo copiar. Copialo a mano.");
    return false;
  }
}

/** Un paso del asistente: número (o tilde cuando ya está hecho) + título. */
function Step({
  n,
  title,
  description,
  done,
  children,
}: {
  n: number;
  title: string;
  description: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-line p-5 first:border-t-0">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums transition-colors",
            done
              ? "bg-tone-emerald-soft text-tone-emerald-text"
              : "bg-ink text-cream",
          )}
          aria-hidden
        >
          {done ? <Check className="size-4 animate-check-pop" strokeWidth={2.5} /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{description}</p>
        </div>
      </div>
      <div className="mt-4 sm:pl-10">{children}</div>
    </div>
  );
}

/** Campo de credencial sensible: ojo para mirar lo que se pega, nada más. */
function SecretField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  loaded,
  loadedLabel,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint: React.ReactNode;
  loaded: boolean;
  loadedLabel: string;
  disabled?: boolean;
}) {
  const [show, setShow] = React.useState(false);
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Label htmlFor={id} className="mb-0">
          {label}
        </Label>
        {loaded && (
          <span className="inline-flex items-center gap-1 rounded-full border border-tone-emerald-line bg-tone-emerald-soft px-2 py-0.5 text-[11px] font-medium leading-4 text-tone-emerald-text">
            <Check className="size-3" strokeWidth={2.75} aria-hidden />
            {loadedLabel}
          </span>
        )}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className="h-11 pr-11 font-mono text-[13px]"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
          className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">{hint}</p>
    </div>
  );
}

/** Campo de dato público (los IDs de Meta): mismo aire, sin ojo. */
function IdField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\s/g, ""))}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={30}
        disabled={disabled}
        className="h-11 font-mono text-[13px]"
      />
      <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">{hint}</p>
    </div>
  );
}

/* Estado del número del lado de Meta, en criollo. */
const NUMBER_STATUS: Record<string, { label: string; chip: string }> = {
  CONNECTED: {
    label: "Activo",
    chip: "border-tone-emerald-line bg-tone-emerald-soft text-tone-emerald-text",
  },
  PENDING: {
    label: "Falta registrarlo",
    chip: "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
  },
  DISCONNECTED: {
    label: "Desconectado",
    chip: "border-tone-red-line bg-tone-red-soft text-tone-red-text",
  },
  FLAGGED: {
    label: "Marcado por calidad",
    chip: "border-tone-red-line bg-tone-red-soft text-tone-red-text",
  },
  RESTRICTED: {
    label: "Restringido",
    chip: "border-tone-red-line bg-tone-red-soft text-tone-red-text",
  },
  BANNED: {
    label: "Bloqueado",
    chip: "border-tone-red-line bg-tone-red-soft text-tone-red-text",
  },
  UNVERIFIED: {
    label: "Sin verificar",
    chip: "border-tone-red-line bg-tone-red-soft text-tone-red-text",
  },
};

function NumberCard({
  phone,
  name,
  status,
  selected,
  busy,
  onSelect,
}: {
  phone: string | null;
  name: string | null;
  status: string | null;
  selected: boolean;
  busy?: boolean;
  onSelect?: () => void;
}) {
  const meta = status
    ? (NUMBER_STATUS[status] ?? {
        label: status.toLowerCase(),
        chip: "border-tone-red-line bg-tone-red-soft text-tone-red-text",
      })
    : null;

  const body = (
    <>
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
          selected ? "bg-brand-600 text-white" : "bg-sand-soft text-ink-faint",
        )}
        aria-hidden
      >
        {selected ? (
          <Check className="size-4 animate-check-pop" strokeWidth={2.5} />
        ) : (
          <Smartphone className="size-4" strokeWidth={1.75} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium tabular-nums text-ink">
          {fmtPhone(phone)}
        </span>
        <span className="block truncate text-xs text-ink-faint">
          {name || "Sin nombre verificado"}
        </span>
      </span>
      {meta && (
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
            meta.chip,
          )}
        >
          {meta.label}
        </span>
      )}
    </>
  );

  if (!onSelect) {
    return (
      <div
        className={cn(
          "flex min-h-[60px] w-full items-center gap-3 rounded-2xl border p-3",
          selected ? "border-brand-tint-line bg-brand-tint" : "border-line bg-paper",
        )}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={busy}
      className={cn(
        "flex min-h-[60px] w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all tap-highlight-none active:scale-[0.99] disabled:opacity-60",
        selected
          ? "border-brand-tint-line bg-brand-tint"
          : "border-line bg-paper hover:border-line-strong hover:bg-sand-soft/50",
      )}
    >
      {body}
    </button>
  );
}

const CHECK_META: Record<CloudCheck["level"], { icon: LucideIcon; color: string }> = {
  ok: { icon: CircleCheck, color: "text-tone-emerald-text" },
  warn: { icon: TriangleAlert, color: "text-tone-amber-text" },
  error: { icon: CircleAlert, color: "text-tone-red-text" },
  pending: { icon: CircleDashed, color: "text-tone-stone-text" },
};

function CheckRow({ check }: { check: CloudCheck }) {
  const meta = CHECK_META[check.level] ?? CHECK_META.pending;
  return (
    <li className="flex items-start gap-3">
      <meta.icon
        className={cn("mt-0.5 size-4.5 shrink-0", meta.color)}
        strokeWidth={1.9}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{check.label}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{check.detail}</p>
        {check.action && (
          <p className="mt-1.5 rounded-xl bg-sand-soft/70 px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
            {check.action}
          </p>
        )}
      </div>
    </li>
  );
}

/* ═══════════════════════════════════════════════════════════
   Cabecera de estado
   ═══════════════════════════════════════════════════════════ */

type Headline = { label: string; hint: string; dot: string; chip: string };

function headline(s: CloudStatus, credsListas: boolean): Headline {
  if (s.connected) {
    return {
      label: "Conectado",
      hint: "Las consultas nuevas entran solas y el sistema contesta al toque.",
      dot: "bg-wa-accent ring-4 ring-wa-accent/15 animate-pulse-dot",
      chip: "border-tone-emerald-line bg-tone-emerald-soft text-tone-emerald-text",
    };
  }
  if (s.checkOk === false) {
    return {
      label: "Con error",
      hint: "Meta no nos está entregando las consultas. Abajo, en el diagnóstico, está qué pasó y cómo se arregla.",
      dot: "bg-red-500 ring-4 ring-tone-red-soft",
      chip: "border-tone-red-line bg-tone-red-soft text-tone-red-text",
    };
  }
  if (!credsListas) {
    return {
      label: "Sin conectar",
      hint: "Cargá los cuatro datos de Meta acá abajo. El sistema se encarga del resto solo.",
      dot: "bg-stone-400 ring-4 ring-tone-stone-soft",
      chip: "border-tone-stone-line bg-tone-stone-soft text-tone-stone-text",
    };
  }
  if (!s.phoneNumberId) {
    return {
      label: "Falta elegir el número",
      hint: "Los datos de Meta ya están validados. Decinos cuál de los números de la cuenta atiende las consultas.",
      dot: "bg-amber-500 ring-4 ring-tone-amber-soft",
      chip: "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
    };
  }
  if (!s.webhookSubscribed) {
    return {
      label: "Falta conectar",
      hint: "Está todo cargado. Tocá Conectar y Meta empieza a mandarnos los mensajes de este número.",
      dot: "bg-amber-500 ring-4 ring-tone-amber-soft",
      chip: "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
    };
  }
  return {
    label: "Casi listo",
    hint: "Meta todavía no te entrega las consultas. En el diagnóstico de abajo está el paso que falta.",
    dot: "bg-amber-500 ring-4 ring-tone-amber-soft",
    chip: "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
  };
}

/* ═══════════════════════════════════════════════════════════
   La pantalla
   ═══════════════════════════════════════════════════════════ */

export function WhatsappSettings({
  channel,
  status: initialStatus,
  statusError,
  webhookBase,
  isAdmin,
}: {
  channel: MotherChannel | null;
  /** Foto de la conexión con Meta (getCloudStatus). */
  status: CloudStatus | null;
  /** Por qué no pudimos leerla, si es que no pudimos. */
  statusError: string | null;
  /** base pública (NEXT_PUBLIC_APP_URL). Si falta, la resolvemos en el navegador. */
  webhookBase: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const origin = React.useSyncExternalStore<string | null>(
    subscribeOrigin,
    clientOrigin,
    serverOrigin,
  );

  /* El estado vive en el cliente porque cada action devuelve la foto nueva (así
     la pantalla responde en el acto), pero el server también revalida: cuando
     llega una foto distinta desde arriba, esa gana. Se sincroniza en el render
     —no en un efecto— para no encadenar renders de más. */
  const [status, setStatus] = React.useState(initialStatus);
  const [lastFromServer, setLastFromServer] = React.useState(initialStatus);
  if (lastFromServer !== initialStatus) {
    setLastFromServer(initialStatus);
    setStatus(initialStatus);
  }

  /* asistente */
  const [token, setToken] = React.useState("");
  const [appId, setAppId] = React.useState(initialStatus?.appId ?? "");
  const [appSecret, setAppSecret] = React.useState("");
  const [wabaId, setWabaId] = React.useState(initialStatus?.wabaId ?? "");
  const [numbers, setNumbers] = React.useState<CloudPhoneNumber[]>([]);
  /* Meta aceptó las credenciales en ESTA sesión. No se persiste a propósito: al
     recargar, lo único que prueba que los datos guardados sirven es un
     diagnóstico en verde (ver credsOk más abajo). */
  const [credsValidadas, setCredsValidadas] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [loadingNumbers, setLoadingNumbers] = React.useState(false);
  const [selecting, setSelecting] = React.useState<string | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [diagnosing, setDiagnosing] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  /* registro */
  const [pin, setPin] = React.useState("");
  const [registering, setRegistering] = React.useState(false);

  /* webhook */
  const [copied, setCopied] = React.useState(false);
  const [verifyToken, setVerifyToken] = React.useState<string | null>(null);
  const [revealing, setRevealing] = React.useState(false);
  const copyTimer = React.useRef<number | null>(null);

  /* respuesta automática */
  const [autoOn, setAutoOn] = React.useState(channel?.autoReplyEnabled ?? true);
  const [autoText, setAutoText] = React.useState(channel?.autoReplyText ?? "");
  const [savingReply, setSavingReply] = React.useState(false);

  /* desconectar */
  const [disconnectOpen, setDisconnectOpen] = React.useState(false);

  React.useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  /* Todos los handlers apagan su spinner en un `finally`: si la sesión se cae,
     la action rechaza y sin eso el botón queda girando para siempre. */
  async function createMother() {
    setCreating(true);
    try {
      const res = await createMotherChannel();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Número madre listo. Ahora cargá los datos de Meta.");
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  /* ── sin número madre todavía ── */
  if (!channel) {
    return (
      <div className="space-y-4">
        <HowItWorks />
        <EmptyState
          icon={Smartphone}
          title="Todavía no hay número madre"
          description={
            isAdmin
              ? "Crealo acá y después conectás la cuenta de Meta en cuatro pasos. Hasta entonces las consultas nuevas no tienen por dónde entrar."
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

  const ch = channel;
  const replyDirty = autoText.trim() !== (channel.autoReplyText ?? "").trim();
  const overLimit = autoText.length > AUTO_REPLY_MAX;

  async function toggleAuto(next: boolean) {
    setAutoOn(next); // optimista
    try {
      const res = await updateChannelSettings({ channelId: ch.id, autoReplyEnabled: next });
      if (!res.ok) {
        setAutoOn(!next);
        toast.error(res.error);
        return;
      }
      toast.success(next ? "Respuesta automática activada." : "Respuesta automática apagada.");
    } catch {
      // si la action rechaza (sesión caída) el optimista queda mintiendo
      setAutoOn(!next);
      toast.error("No se pudo guardar. Recargá la página y probá de nuevo.");
    }
  }

  async function saveReply() {
    if (overLimit) {
      toast.error(`El mensaje es muy largo. Dejalo en ${AUTO_REPLY_MAX} caracteres o menos.`);
      return;
    }
    setSavingReply(true);
    try {
      const res = await updateChannelSettings({
        channelId: ch.id,
        autoReplyText: autoText.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Respuesta automática guardada.");
    } finally {
      setSavingReply(false);
    }
  }

  /* ── el bloque de la respuesta automática se usa en los dos caminos ── */
  const autoReplySection = (
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
  );

  /* ── no pudimos leer el estado de la conexión ── */
  if (!status) {
    return (
      <div className="space-y-4">
        <HowItWorks />
        <div className="flex items-start gap-3 rounded-2xl border border-tone-amber-line bg-tone-amber-soft px-4 py-3.5 animate-fade-in">
          <TriangleAlert
            className="mt-0.5 size-4.5 shrink-0 text-tone-amber-text"
            strokeWidth={1.9}
            aria-hidden
          />
          <p className="text-sm leading-relaxed text-tone-amber-text">
            {statusError ??
              "No pudimos leer el estado de la conexión con Meta. Recargá la página en un rato."}
          </p>
        </div>
        {autoReplySection}
      </div>
    );
  }

  const st = status; // binding const: mantiene el estrechamiento en los handlers
  const phone = st.phone ?? ch.phone;
  const credsListas = st.hasToken && st.hasAppSecret && !!st.appId && !!st.wabaId;
  const head = headline(st, credsListas || st.usingEnvFallback);
  const base = webhookBase ?? origin;
  const webhookPath = st.webhookPath || WEBHOOK_BASE_PATH;
  const webhookUrl = base ? `${base}${webhookPath}` : null;

  const credsDirty =
    token.trim().length > 0 ||
    appSecret.trim().length > 0 ||
    appId.trim() !== (st.appId ?? "") ||
    wabaId.trim() !== (st.wabaId ?? "");

  /* Cargado no es lo mismo que validado: el guardado escribe los secretos ANTES
     de probarlos contra Meta, así que una validación que falla igual deja los
     cuatro datos en la base. Si damos el paso por hecho con eso solo, después de
     recargar queda el tilde verde y el botón apagado, sin forma de reintentar.
     Cuenta como listo el OK de Meta de esta sesión o un diagnóstico en verde. */
  const credsOk = credsListas && (credsValidadas || st.checkOk === true);

  const numeroCheck = st.checks.find((c) => c.key === "numero");
  const faltaRegistrar = numeroCheck?.level === "warn" || numeroCheck?.level === "error";
  const registrado = numeroCheck?.level === "ok" || st.connected;

  /* ── acciones del asistente ── */

  async function saveCreds() {
    setSaving(true);
    // hasta que Meta no los acepte de nuevo, lo guardado no cuenta como validado
    setCredsValidadas(false);
    try {
      const res = await saveCloudCredentials({
        token: token.trim() || undefined,
        appId: appId.trim() || undefined,
        appSecret: appSecret.trim() || undefined,
        wabaId: wabaId.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      const saved = res.data.status;
      setStatus(saved);
      setNumbers(res.data.numbers);
      setCredsValidadas(true);
      setToken("");
      setAppSecret("");
      setAppId(saved.appId ?? "");
      setWabaId(saved.wabaId ?? "");

      // un solo número en la cuenta: lo elegimos nosotros y se lo mostramos igual
      if (!saved.phoneNumberId && res.data.numbers.length === 1) {
        const only = res.data.numbers[0];
        const sel = await selectCloudNumber({ phoneNumberId: only.id });
        if (sel.ok) {
          setStatus(sel.data);
          toast.success("Datos validados. La cuenta tiene un solo número, así que lo elegimos.");
          return;
        }
      }
      toast.success(
        saved.phoneNumberId
          ? "Datos validados contra Meta."
          : "Datos validados. Ahora elegí el número que atiende.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function fetchNumbers() {
    setLoadingNumbers(true);
    try {
      const res = await saveCloudCredentials({});
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setStatus(res.data.status);
      setNumbers(res.data.numbers);
      setCredsValidadas(true); // si trajo los números, Meta aceptó las credenciales
      // "no pudimos preguntar" no es lo mismo que "no tiene ninguno": afirmar
      // que la cuenta está vacía cuando Meta se cayó manda a buscar el problema
      // al lugar equivocado.
      if (res.data.numbersError) {
        toast.error(res.data.numbersError);
      } else if (res.data.numbers.length === 0) {
        toast.error("La cuenta de Meta no tiene ningún número dado de alta todavía.");
      }
    } finally {
      setLoadingNumbers(false);
    }
  }

  async function pickNumber(phoneNumberId: string) {
    setSelecting(phoneNumberId);
    try {
      const res = await selectCloudNumber({ phoneNumberId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setStatus(res.data);
      toast.success("Número elegido.");
    } finally {
      setSelecting(null);
    }
  }

  async function connect() {
    setConnecting(true);
    try {
      const res = await connectCloud();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setStatus(res.data);
      toast.success(
        res.data.connected
          ? "Conectado. Las consultas ya entran solas."
          : "Le avisamos a Meta. Mirá el diagnóstico: falta un paso.",
      );
    } finally {
      setConnecting(false);
    }
  }

  async function diagnose() {
    setDiagnosing(true);
    try {
      const res = await runCloudDiagnostics();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setStatus(res.data);
      toast.success(res.data.checkOk ? "Está todo en orden." : "Revisado. Mirá lo que falta.");
    } finally {
      setDiagnosing(false);
    }
  }

  async function register() {
    if (!/^\d{6}$/.test(pin)) {
      toast.error("El PIN son 6 números, sin letras ni espacios.");
      return;
    }
    setRegistering(true);
    try {
      const res = await registerMotherNumber({ pin });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setPin("");
      setStatus(res.data);
      toast.success("Número registrado. Ya puede recibir consultas.");
    } finally {
      setRegistering(false);
    }
  }

  async function reveal() {
    setRevealing(true);
    try {
      const res = await revealVerifyToken();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setVerifyToken(res.data.verifyToken);
    } finally {
      setRevealing(false);
    }
  }

  async function copyWebhook() {
    if (!webhookUrl) return;
    const ok = await copyToClipboard(webhookUrl, "URL copiada.");
    if (!ok) return;
    setCopied(true);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
  }

  async function disconnect() {
    const res = await disconnectCloud();
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setDisconnectOpen(false);
    setNumbers([]);
    setCredsValidadas(false);
    setVerifyToken(null);
    setToken("");
    setAppSecret("");
    setAppId("");
    setWabaId("");
    toast.success("Cuenta de Meta desconectada.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <HowItWorks />

      {st.usingEnvFallback && (
        <div className="flex items-start gap-3 rounded-2xl border border-tone-amber-line bg-tone-amber-soft px-4 py-3.5 animate-fade-in">
          <TriangleAlert
            className="mt-0.5 size-4.5 shrink-0 text-tone-amber-text"
            strokeWidth={1.9}
            aria-hidden
          />
          <p className="text-sm leading-relaxed text-tone-amber-text">
            Por ahora el sistema anda con la configuración vieja del servidor. Cargá los datos de
            Meta acá abajo y queda todo en un solo lugar, sin depender de nadie más.
          </p>
        </div>
      )}

      {/* ── 2. Cabecera de estado ── */}
      <section className="card p-5 animate-fade-in">
        <div className="flex items-start gap-3">
          <span className={cn("mt-1.5 size-3 shrink-0 rounded-full", head.dot)} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-semibold text-ink">{head.label}</h2>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[12px] font-medium tabular-nums",
                  head.chip,
                )}
              >
                {phone ? fmtPhone(phone) : "Sin número"}
              </span>
            </div>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{head.hint}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-faint">
              {st.wabaName && <span className="truncate">Cuenta: {st.wabaName}</span>}
              {st.wabaName && st.checkedAt && <span aria-hidden>·</span>}
              {st.checkedAt && <span>Último chequeo {fmtRelative(st.checkedAt)}</span>}
            </div>
          </div>
        </div>
      </section>

      {isAdmin && (
        <>
          {/* ── 3, 4 y 5. El asistente ── */}
          <section className="card overflow-hidden p-0 animate-fade-in">
            <Step
              n={1}
              title="Los datos de Meta"
              description="Cuatro datos que están en el panel de Meta. Copialos y pegalos; cuando guardes, el sistema los prueba contra Meta y te dice si están bien."
              done={credsOk}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <SecretField
                    id="wa-token"
                    label="Token de acceso"
                    value={token}
                    onChange={setToken}
                    loaded={st.hasToken}
                    loadedLabel={st.tokenTail ? `Cargado ····${st.tokenTail}` : "Cargado"}
                    placeholder={
                      st.hasToken ? "Dejalo vacío para no cambiarlo" : "EAAG… (pegá el token entero)"
                    }
                    hint={
                      <>
                        Lo generás en{" "}
                        <Crumb
                          parts={[
                            "Configuración del negocio",
                            "Usuarios del sistema",
                            "Generar token",
                          ]}
                        />
                        . Tiene que ser el permanente: vencimiento{" "}
                        <span className="font-medium text-ink">Nunca</span> y los tres permisos de
                        WhatsApp tildados. Si vence, deja de entrar todo.
                      </>
                    }
                  />
                </div>

                <IdField
                  id="wa-appid"
                  label="App ID"
                  value={appId}
                  onChange={setAppId}
                  placeholder="1234567890123456"
                  hint={
                    <>
                      Está en{" "}
                      <Crumb parts={["Meta for Developers", "Configuración", "Básica"]} />. Son solo
                      números.
                    </>
                  }
                />

                <SecretField
                  id="wa-appsecret"
                  label="App Secret"
                  value={appSecret}
                  onChange={setAppSecret}
                  loaded={st.hasAppSecret}
                  loadedLabel="Cargado"
                  placeholder={st.hasAppSecret ? "Dejalo vacío para no cambiarlo" : "32 caracteres"}
                  hint={
                    <>
                      En el mismo lugar que el App ID, tapado: tocá{" "}
                      <span className="font-medium text-ink">Mostrar</span> y copialo.
                    </>
                  }
                />

                <IdField
                  id="wa-wabaid"
                  label="WABA ID"
                  value={wabaId}
                  onChange={setWabaId}
                  placeholder="1234567890123456"
                  hint={
                    <>
                      Es el número de tu cuenta de WhatsApp Business. Está en{" "}
                      <Crumb parts={["WhatsApp Manager"]} />, arriba a la izquierda.
                    </>
                  }
                />
              </div>

              <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-sand-soft/60 px-3.5 py-2.5">
                <Lock className="mt-0.5 size-4 shrink-0 text-ink-faint" strokeWidth={1.9} aria-hidden />
                <p className="text-xs leading-relaxed text-ink-soft">
                  El token y el App Secret se guardan cifrados. Una vez guardados no se pueden
                  volver a ver desde esta pantalla: los usa el sistema, y nada más que para hablar
                  con Meta.
                </p>
              </div>

              <div className="mt-4 flex justify-end">
                {/* Sin cambios el botón sigue vivo mientras lo guardado no tenga
                    el visto bueno de Meta: reintentar es volver a validar lo que
                    ya está en la base, aunque los campos estén vacíos. */}
                <Button
                  onClick={saveCreds}
                  loading={saving}
                  disabled={!credsDirty && (credsOk || !credsListas)}
                  size="lg"
                >
                  <ShieldCheck />
                  {credsDirty || !credsListas ? "Guardar y validar" : "Validar de nuevo"}
                </Button>
              </div>
            </Step>

            <Step
              n={2}
              title="El número que atiende"
              description="De todos los números de tu cuenta de Meta, cuál es el que ve el público y por el que entran las consultas."
              done={!!st.phoneNumberId}
            >
              {!credsListas ? (
                <p className="text-sm text-ink-faint">
                  Primero guardá los datos de Meta: los números los trae el sistema solo.
                </p>
              ) : (
                <>
                  {numbers.length > 0 ? (
                    <ul className="space-y-2 stagger-children">
                      {numbers.map((n) => (
                        <li key={n.id}>
                          <NumberCard
                            phone={n.displayPhoneNumber}
                            name={n.verifiedName}
                            status={n.status}
                            selected={n.id === st.phoneNumberId}
                            busy={selecting !== null}
                            onSelect={
                              n.id === st.phoneNumberId ? undefined : () => pickNumber(n.id)
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  ) : st.phoneNumberId ? (
                    <NumberCard
                      phone={st.phone}
                      name={st.wabaName}
                      status={registrado ? "CONNECTED" : faltaRegistrar ? "PENDING" : null}
                      selected
                    />
                  ) : (
                    <p className="text-sm text-ink-soft">
                      Traemos la lista de números de tu cuenta y elegís uno.
                    </p>
                  )}

                  <div className="mt-3 flex justify-start">
                    <Button
                      variant="secondary"
                      onClick={fetchNumbers}
                      loading={loadingNumbers}
                      className="h-11 sm:h-10"
                    >
                      {numbers.length > 0 ? <RefreshCw /> : <Search />}
                      {st.phoneNumberId ? "Elegir otro número" : "Buscar los números de la cuenta"}
                    </Button>
                  </div>
                </>
              )}
            </Step>

            <Step
              n={3}
              title="Conectar"
              description="Le decimos a Meta que nos mande a este sistema los mensajes de este número. Es el paso que hace que las consultas entren solas."
              done={st.webhookSubscribed}
            >
              {!st.phoneNumberId ? (
                <p className="text-sm text-ink-faint">
                  Elegí el número de arriba y este botón se prende.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={connect}
                    loading={connecting}
                    size="lg"
                    variant={st.webhookSubscribed ? "secondary" : "primary"}
                  >
                    <PlugZap />
                    {st.webhookSubscribed ? "Volver a conectar" : "Conectar"}
                  </Button>
                  {st.webhookSubscribed && (
                    <p className="text-xs text-ink-faint">
                      Ya está conectado. Repetilo solo si cambiaste algo en Meta.
                    </p>
                  )}
                </div>
              )}
            </Step>
          </section>

          {/* ── 6. Diagnóstico ── */}
          <section className="card p-5 animate-fade-in">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text">
                  <ListChecks className="size-4.5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold text-ink">Diagnóstico</h2>
                  <p className="text-sm leading-relaxed text-ink-soft">
                    Lo que ve Meta de tu cuenta, en criollo.
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                onClick={diagnose}
                loading={diagnosing}
                disabled={!credsListas && !st.usingEnvFallback}
                className="h-11 shrink-0 sm:h-10"
              >
                <RefreshCw />
                <span className="hidden sm:inline">Revisar de nuevo</span>
                <span className="sm:hidden">Revisar</span>
              </Button>
            </div>

            {st.checks.length > 0 ? (
              <ul className="mt-5 space-y-4 stagger-children">
                {st.checks.map((c, i) => (
                  <CheckRow key={`${c.key}-${i}`} check={c} />
                ))}
              </ul>
            ) : (
              <p className="mt-4 rounded-xl bg-sand-soft/60 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-soft">
                Todavía no revisamos nada. Guardá los datos de Meta y tocá Conectar: acá te vamos a
                decir, punto por punto, qué está bien y qué falta.
              </p>
            )}
          </section>

          {/* ── 7. Registrar el número ── */}
          {st.phoneNumberId && (faltaRegistrar || registrado) && (
            <section className="card p-5 animate-fade-in">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text">
                  <ShieldCheck className="size-4.5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold text-ink">
                    {registrado ? "Volver a registrar el número" : "Registrar el número"}
                  </h2>
                  <p className="text-sm leading-relaxed text-ink-soft">
                    {registrado ? (
                      <>
                        Ya está registrado. Solo hace falta repetirlo si cambiaste el número, la
                        cuenta de Meta o si Meta te lo dio de baja.
                      </>
                    ) : (
                      <>
                        Meta da de alta y verifica el número, pero el registro final va por API: en
                        su panel el botón queda gris y el número se queda en{" "}
                        <span className="font-medium text-ink">Pendiente</span>. Hasta que no lo
                        registres acá, no te entrega ninguna consulta.
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="mt-4 sm:max-w-xs">
                <Label htmlFor="wa-pin">PIN de 6 dígitos</Label>
                <Input
                  id="wa-pin"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  aria-describedby="wa-pin-hint"
                  className="h-11 font-mono text-[15px] tracking-[0.35em]"
                />
                <p id="wa-pin-hint" className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                  Es la verificación en dos pasos del número. Si ya la tenés activa, poné{" "}
                  <span className="font-medium text-ink-soft">ese mismo</span> PIN. Si no, el que
                  cargues queda fijado — anotalo, Meta te lo vuelve a pedir. No queda guardado en el
                  sistema.
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                  Si no te acordás, cambialo en{" "}
                  <Crumb parts={["WhatsApp Manager", "el número", "Verificación en dos pasos"]} />{" "}
                  antes de reintentar. No pruebes PINs al azar: a los 10 intentos Meta bloquea el
                  registro del número por 72 horas.
                </p>
              </div>

              <div className="mt-4 flex justify-end">
                <Button
                  onClick={register}
                  loading={registering}
                  variant={registrado ? "secondary" : "primary"}
                  disabled={pin.length !== 6}
                  size="lg"
                >
                  {registrado ? "Volver a registrar" : "Registrar número"}
                </Button>
              </div>
            </section>
          )}

          {/* ── 8. Webhook ── */}
          <section className="card p-5 animate-fade-in">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text">
                <Webhook className="size-4.5" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold text-ink">Webhook</h2>
                <p className="text-sm leading-relaxed text-ink-soft">
                  Es la puerta por donde Meta le pasa al sistema los mensajes de tus clientes. Esta
                  dirección es la de tu agencia y{" "}
                  {st.webhookSubscribed
                    ? "ya quedó configurada en Meta: no tenés que tocar nada."
                    : "la configura el sistema solo cuando tocás Conectar."}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-xl border border-line bg-sand-soft/60 px-3.5 py-2.5 font-mono text-[12px] text-ink-soft">
                {webhookUrl ?? webhookPath}
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

            {verifyToken ? (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-sand-soft/60 px-3.5 py-2.5 animate-slide-up">
                <KeyRound className="size-4 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-wide text-ink-faint">Verify token</p>
                  <p className="truncate font-mono text-[13px] font-medium text-ink">
                    {verifyToken}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(verifyToken, "Verify token copiado.")}
                  aria-label="Copiar verify token"
                  className="shrink-0 rounded-lg p-2.5 text-ink-faint transition-colors hover:bg-paper hover:text-ink tap-highlight-none active:scale-95"
                >
                  <Copy className="size-4" />
                </button>
              </div>
            ) : (
              <div className="mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={reveal}
                  loading={revealing}
                  className="h-11 px-2 sm:h-8"
                >
                  <KeyRound />
                  Ver el verify token
                </Button>
                <p className="mt-1 px-2 text-xs leading-relaxed text-ink-faint">
                  Solo lo necesitás si alguna vez tenés que cargar el webhook a mano en el panel de
                  Meta.
                </p>
              </div>
            )}
          </section>
        </>
      )}

      {/* ── 9. Respuesta automática ── */}
      {autoReplySection}

      {!isAdmin && (
        <p className="px-1 text-xs text-ink-faint">
          La conexión con Meta la maneja un admin de la agencia.
        </p>
      )}

      {/* ── 10. Desconectar ── */}
      {isAdmin && (credsListas || st.hasToken || !!st.appId) && (
        <div className="flex justify-center pb-2">
          <button
            type="button"
            onClick={() => setDisconnectOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-xl px-3 text-[13px] font-medium text-ink-faint transition-colors hover:bg-tone-red-soft hover:text-tone-red-text tap-highlight-none active:scale-[0.98]"
          >
            <Unplug className="size-4" strokeWidth={1.9} aria-hidden />
            Desconectar la cuenta de Meta
          </button>
        </div>
      )}

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="¿Desconectar la cuenta de Meta?"
        description="Dejan de entrar las consultas nuevas por el número madre. Los chats y los leads quedan como están. Para volver a conectarla vas a tener que cargar los datos de Meta otra vez."
        confirmLabel="Desconectar"
        onConfirm={disconnect}
      />
    </div>
  );
}
