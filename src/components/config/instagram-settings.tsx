"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  KeyRound,
  ListChecks,
  Lock,
  MessageSquareReply,
  Plus,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Unplug,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { EmptyState, Switch } from "@/components/ui/misc";
import { InstagramIcon, WhatsAppIcon } from "@/components/ui/brand-icons";
import { ConfirmDialog } from "@/components/config/confirm-dialog";
import {
  CheckRow,
  CopyRow,
  Crumb,
  IdField,
  SecretField,
  Step,
} from "@/components/config/wizard-bits";
import { updateChannelSettings } from "@/lib/actions/branches";
import {
  connectInstagram,
  createInstagramChannel,
  disconnectInstagram,
  refreshInstagramToken,
  revealIgVerifyToken,
  runInstagramDiagnostics,
  saveInstagramCredentials,
  updateInstagramBridge,
  type IgStatus,
} from "@/lib/actions/instagram";
import { IG_WEBHOOK_BASE_PATH } from "@/lib/ig/routes";
import { fmtPhone, fmtRelative } from "@/lib/format";
import { waLink } from "@/lib/domain";
import { cn } from "@/lib/utils";

const AUTO_REPLY_MAX = 1000;

/* Origen del navegador para armar la URL del webhook cuando falta la env.
   Con useSyncExternalStore el server rinde null y el cliente completa después
   de hidratar: sin mismatch y sin setState dentro de un efecto. */
const subscribeOrigin = () => () => {};
const clientOrigin = (): string | null => window.location.origin;
const serverOrigin = (): string | null => null;

export type IgChannel = {
  id: string;
  label: string;
  autoReplyEnabled: boolean;
  autoReplyText: string;
};

export type WaNumberOption = { phone: string; label: string; isDefault: boolean };

/** Valor del selector cuando el número lo elige el sistema. */
const AUTO_PHONE = "";
/** …y cuando el admin quiere uno que no está en el sistema. */
const OTHER_PHONE = "otro";

/* ═══════════════════════════════════════════════════════════
   Cómo funciona (el mapa mental del negocio)
   ═══════════════════════════════════════════════════════════ */

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: MessageSquareReply,
    title: "El DM entra al CRM",
    body: "Cada mensaje directo crea el contacto y el lead, y se deriva a la sucursal con las mismas reglas que WhatsApp. Se contesta desde el chat, sin abrir Instagram.",
  },
  {
    icon: Sparkles,
    title: "El sistema contesta solo y ofrece WhatsApp",
    body: "La respuesta automática sale al instante con un link a tu WhatsApp y un botón para que la persona comparta su número con un toque.",
  },
  {
    icon: MessageSquareReply,
    title: "La venta sigue por WhatsApp",
    body: "Con el teléfono, el vendedor le escribe desde el número de la sucursal — sin ventana de 24 hs. Y es el mismo contacto: no se duplica nada.",
  },
];

function HowItWorks() {
  return (
    <section className="card p-5 animate-slide-up">
      <h2 className="font-display text-lg font-semibold text-ink">Cómo funciona</h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        Instagram trae la consulta; WhatsApp cierra la venta.
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

      <p className="mt-4 rounded-xl bg-sand-soft/70 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-soft">
        Para tu propia cuenta, Meta no te pide verificación del negocio ni revisión de la
        app: alcanza con que la cuenta de Instagram sea profesional y que tu usuario tenga
        rol en la app. Es bastante más simple que WhatsApp.
      </p>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Cabecera de estado
   ═══════════════════════════════════════════════════════════ */

type Headline = { label: string; hint: string; dot: string; chip: string };

function headline(s: IgStatus, credsListas: boolean): Headline {
  if (s.connected) {
    return {
      label: "Conectado",
      hint: "Los mensajes de Instagram entran solos y el sistema contesta al toque.",
      dot: "bg-wa-accent ring-4 ring-wa-accent/15 animate-pulse-dot",
      chip: "border-tone-emerald-line bg-tone-emerald-soft text-tone-emerald-text",
    };
  }
  if (s.checkOk === false) {
    return {
      label: "Con error",
      hint: "Algo dejó de andar. Abajo, en el diagnóstico, está qué pasó y cómo se arregla.",
      dot: "bg-red-500 ring-4 ring-tone-red-soft",
      chip: "border-tone-red-line bg-tone-red-soft text-tone-red-text",
    };
  }
  if (!credsListas) {
    return {
      label: "Sin conectar",
      hint: "Cargá el token y los datos de la app acá abajo. Son tres pasos.",
      dot: "bg-stone-400 ring-4 ring-tone-stone-soft",
      chip: "border-tone-stone-line bg-tone-stone-soft text-tone-stone-text",
    };
  }
  if (!s.webhookSubscribed) {
    return {
      label: "Falta conectar",
      hint: "Ya validamos la cuenta. Pegá la dirección del webhook en Meta y tocá Conectar.",
      dot: "bg-amber-500 ring-4 ring-tone-amber-soft",
      chip: "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
    };
  }
  return {
    label: "Casi listo",
    hint: "Meta todavía no te entrega los mensajes. En el diagnóstico está el paso que falta.",
    dot: "bg-amber-500 ring-4 ring-tone-amber-soft",
    chip: "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
  };
}

/* ═══════════════════════════════════════════════════════════
   La pantalla
   ═══════════════════════════════════════════════════════════ */

export function InstagramSettings({
  channel,
  status: initialStatus,
  statusError,
  webhookBase,
  waNumbers,
  isAdmin,
}: {
  channel: IgChannel | null;
  status: IgStatus | null;
  statusError: string | null;
  webhookBase: string | null;
  /** números de WhatsApp de la agencia para el puente */
  waNumbers: WaNumberOption[];
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
     llega una foto distinta desde arriba, esa gana. */
  const [status, setStatus] = React.useState(initialStatus);
  const [lastFromServer, setLastFromServer] = React.useState(initialStatus);
  if (lastFromServer !== initialStatus) {
    setLastFromServer(initialStatus);
    setStatus(initialStatus);
  }

  /* asistente */
  const [token, setToken] = React.useState("");
  const [igAppId, setIgAppId] = React.useState(initialStatus?.igAppId ?? "");
  const [igAppSecret, setIgAppSecret] = React.useState("");
  const [appId, setAppId] = React.useState(initialStatus?.appId ?? "");
  const [appSecret, setAppSecret] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);
  const [diagnosing, setDiagnosing] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  /* webhook */
  const [verifyToken, setVerifyToken] = React.useState<string | null>(null);
  const [revealing, setRevealing] = React.useState(false);

  /* respuesta automática */
  const [autoOn, setAutoOn] = React.useState(channel?.autoReplyEnabled ?? true);
  const [autoText, setAutoText] = React.useState(channel?.autoReplyText ?? "");
  const [savingReply, setSavingReply] = React.useState(false);

  /* puente */
  const bridge = status?.bridge;
  const [bridgeOn, setBridgeOn] = React.useState(bridge?.enabled ?? true);
  const [bridgePhone, setBridgePhone] = React.useState(bridge?.phone ?? AUTO_PHONE);
  const [bridgeMode, setBridgeMode] = React.useState<string>(() => {
    if (!bridge?.phone) return AUTO_PHONE;
    return waNumbers.some((n) => n.phone === bridge.phone) ? bridge.phone : OTHER_PHONE;
  });
  const [bridgeLabel, setBridgeLabel] = React.useState(bridge?.label ?? "");
  const [bridgeText, setBridgeText] = React.useState(bridge?.text ?? "");
  const [autoWa, setAutoWa] = React.useState(bridge?.autoWa ?? false);
  const [autoWaText, setAutoWaText] = React.useState(bridge?.autoWaText ?? "");
  const [humanAgent, setHumanAgent] = React.useState(status?.humanAgentEnabled ?? false);
  const [savingBridge, setSavingBridge] = React.useState(false);

  /* desconectar */
  const [disconnectOpen, setDisconnectOpen] = React.useState(false);

  /* `createInstagramChannel` y `updateChannelSettings` TIRAN si no hay sesión
     (requireAction), no devuelven `fail`. Sin el catch, una sesión vencida deja
     el botón como si nada hubiera pasado y el admin se va creyendo que guardó. */
  async function createChannel() {
    setCreating(true);
    try {
      const res = await createInstagramChannel();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Canal de Instagram listo. Ahora cargá los datos de Meta.");
      router.refresh();
    } catch {
      toast.error("Se cerró la sesión. Volvé a entrar y probá de nuevo.");
    } finally {
      setCreating(false);
    }
  }

  /* ── sin canal todavía ── */
  if (!channel) {
    return (
      <div className="space-y-4">
        <HowItWorks />
        <EmptyState
          icon={InstagramIcon}
          title="Todavía no está el canal de Instagram"
          description={
            isAdmin
              ? "Crealo acá y después conectás la cuenta en tres pasos. Hasta entonces los mensajes directos siguen viviendo en el celular de alguien."
              : "Lo tiene que crear un admin de la agencia."
          }
          action={
            isAdmin ? (
              <Button onClick={createChannel} loading={creating}>
                <Plus />
                Crear el canal de Instagram
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
    } catch {
      toast.error("Se cerró la sesión. Volvé a entrar y probá de nuevo.");
    } finally {
      setSavingReply(false);
    }
  }

  /* ── el número al que va el cliente cuando toca el link ── */

  /* Lo que se GUARDA: null en automático (el sistema lo resuelve en el momento,
     con la sucursal que atiende cada consulta). Es distinto de lo que se muestra
     en la vista previa, y confundirlos hacía que el botón "Guardar puente"
     quedara habilitado para siempre. */
  const phoneToSave =
    bridgeMode === AUTO_PHONE
      ? null
      : bridgeMode === OTHER_PHONE
        ? bridgePhone.replace(/\D/g, "") || null
        : bridgeMode;

  /* Lo que se MUESTRA en la vista previa: en automático, el número que hoy
     saldría (el de la sucursal por defecto). */
  const resolvedBridgePhone =
    phoneToSave ?? (waNumbers.find((n) => n.isDefault) ?? waNumbers[0])?.phone ?? null;

  /* Lo que le llega de verdad al cliente: el saludo + el renglón del puente.
     Se arma acá para que la vista previa no mienta. */
  const previewText = [
    autoText.trim() || "Escribí el mensaje que le va a llegar a la persona.",
    bridgeOn && resolvedBridgePhone
      ? `${bridgeLabel.trim() || "Escribinos por WhatsApp"}: ${waLink(
          resolvedBridgePhone,
          `${bridgeText.trim() || "¡Hola! Les escribo desde Instagram."}\n\nRef. IG-XXXXXXXX`,
        )}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  /* ── el bloque de la respuesta automática (se usa en los dos caminos) ── */
  const autoReplySection = (
    <section className="card p-5 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-ink">Respuesta automática</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            Lo primero que lee la persona. Es también el lugar donde aparece el link a tu
            WhatsApp.
          </p>
        </div>
        <Switch
          checked={autoOn}
          onCheckedChange={toggleAuto}
          disabled={!isAdmin}
          aria-label="Activar la respuesta automática"
        />
      </div>

      <div className="mt-4">
        <Label htmlFor="ig-auto">Mensaje</Label>
        <Textarea
          id="ig-auto"
          value={autoText}
          onChange={(e) => setAutoText(e.target.value)}
          placeholder="¡Hola! Gracias por escribirnos. Contanos a dónde querés viajar y en qué fechas."
          rows={4}
          disabled={!isAdmin}
          className="min-h-[104px]"
        />
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <p className="text-xs text-ink-faint">
            {autoOn
              ? "Sale la primera vez que alguien escribe, y cuando vuelve después de cerrar el lead."
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

        {/* Vista previa: así lo ve la persona en su Instagram */}
        <p className="mb-1.5 mt-4 text-[13px] font-medium text-ink-soft">Así lo ve la persona</p>
        <div
          className={cn(
            "rounded-2xl border border-line bg-sand-soft/50 p-3 transition-opacity",
            !autoOn && "opacity-60",
          )}
        >
          <div className="flex justify-end">
            <div className="max-w-[88%] rounded-[20px] rounded-br-md bg-gradient-to-br from-violet-500 via-fuchsia-500 to-orange-400 px-3.5 py-2 shadow-sm">
              <p className="whitespace-pre-wrap break-words text-[14px] leading-snug text-white">
                {previewText}
              </p>
            </div>
          </div>
          {bridgeOn && (
            <div className="mt-2 flex justify-end">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-paper px-3 py-1 text-[12px] font-medium text-ink-soft">
                <WhatsAppIcon className="size-3.5 text-wa-accent" />
                Compartir mi WhatsApp
              </span>
            </div>
          )}
          <p className="mt-2 text-center text-[11px] leading-snug text-ink-faint">
            {bridgeOn
              ? "El botón le muestra su propio número: lo comparte con un toque, sin tipear."
              : "El puente a WhatsApp está apagado: el mensaje sale sin link ni botón."}
          </p>
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

  /* ── no pudimos leer el estado ── */
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
              "No pudimos leer el estado de la conexión con Instagram. Recargá la página en un rato."}
          </p>
        </div>
        {autoReplySection}
      </div>
    );
  }

  const st = status; // binding const: mantiene el estrechamiento en los handlers
  const credsListas = st.hasToken && (st.hasAppSecret || st.hasIgAppSecret) && !!st.igUserId;
  const head = headline(st, credsListas);
  const base = webhookBase ?? origin;
  const webhookUrl = base ? `${base}${st.webhookPath || IG_WEBHOOK_BASE_PATH}` : null;

  const credsDirty =
    token.trim().length > 0 ||
    igAppSecret.trim().length > 0 ||
    appSecret.trim().length > 0 ||
    igAppId.trim() !== (st.igAppId ?? "") ||
    appId.trim() !== (st.appId ?? "");

  const bridgeDirty =
    bridgeOn !== st.bridge.enabled ||
    phoneToSave !== (st.bridge.phone ?? null) ||
    bridgeLabel.trim() !== st.bridge.label ||
    bridgeText.trim() !== st.bridge.text ||
    autoWa !== st.bridge.autoWa ||
    autoWaText.trim() !== st.bridge.autoWaText ||
    humanAgent !== st.humanAgentEnabled;

  /* ── acciones ── */

  async function saveCreds() {
    setSaving(true);
    try {
      const res = await saveInstagramCredentials({
        token: token.trim() || undefined,
        igAppId: igAppId.trim() || undefined,
        igAppSecret: igAppSecret.trim() || undefined,
        appId: appId.trim() || undefined,
        appSecret: appSecret.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setStatus(res.data);
      setToken("");
      setIgAppSecret("");
      setAppSecret("");
      setIgAppId(res.data.igAppId ?? "");
      setAppId(res.data.appId ?? "");
      toast.success(
        res.data.username
          ? `Listo, es la cuenta @${res.data.username}.`
          : "Datos validados contra Meta.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function connect() {
    setConnecting(true);
    try {
      const res = await connectInstagram();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setStatus(res.data);
      toast.success(
        res.data.connected
          ? "Conectado. Los mensajes de Instagram ya entran solos."
          : "Le avisamos a Meta. Mirá el diagnóstico: falta un paso.",
      );
    } finally {
      setConnecting(false);
    }
  }

  async function diagnose() {
    setDiagnosing(true);
    try {
      const res = await runInstagramDiagnostics();
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

  async function renewToken() {
    setRefreshing(true);
    try {
      const res = await refreshInstagramToken();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setStatus(res.data);
      toast.success("Token renovado por 60 días más.");
    } finally {
      setRefreshing(false);
    }
  }

  async function reveal() {
    setRevealing(true);
    try {
      const res = await revealIgVerifyToken();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setVerifyToken(res.data.verifyToken);
    } finally {
      setRevealing(false);
    }
  }

  async function saveBridge() {
    setSavingBridge(true);
    try {
      const res = await updateInstagramBridge({
        enabled: bridgeOn,
        phone: phoneToSave,
        label: bridgeLabel.trim() || undefined,
        text: bridgeText.trim() || undefined,
        autoWa,
        autoWaText: autoWaText.trim() || undefined,
        humanAgent,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setStatus(res.data);
      toast.success("Puente a WhatsApp guardado.");
    } finally {
      setSavingBridge(false);
    }
  }

  async function disconnect() {
    const res = await disconnectInstagram();
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setDisconnectOpen(false);
    setVerifyToken(null);
    setToken("");
    setIgAppSecret("");
    setAppSecret("");
    setIgAppId("");
    setAppId("");
    toast.success("Cuenta de Instagram desconectada.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <HowItWorks />

      {/* ── Cabecera de estado ── */}
      <section className="card p-5 animate-fade-in">
        <div className="flex items-start gap-3">
          {st.profilePictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={st.profilePictureUrl}
              alt=""
              className="size-12 shrink-0 rounded-full object-cover ring-2 ring-line"
            />
          ) : (
            <span
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-orange-400 text-white"
              aria-hidden
            >
              <InstagramIcon className="size-6" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-semibold text-ink">{head.label}</h2>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[12px] font-medium",
                  head.chip,
                )}
              >
                {st.username ? `@${st.username}` : "Sin cuenta"}
              </span>
              <span className={cn("size-2.5 shrink-0 rounded-full", head.dot)} aria-hidden />
            </div>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{head.hint}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-faint">
              {st.accountName && <span className="truncate">{st.accountName}</span>}
              {st.followersCount != null && (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">
                    {st.followersCount.toLocaleString("es-AR")} seguidores
                  </span>
                </>
              )}
              {st.checkedAt && (
                <>
                  <span aria-hidden>·</span>
                  <span>Último chequeo {fmtRelative(st.checkedAt)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* El token vence a los 60 días: si está cerca, es lo más importante de
            la pantalla y no puede estar escondido en el diagnóstico. */}
        {st.tokenDaysLeft != null && st.tokenDaysLeft <= 15 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-tone-amber-line bg-tone-amber-soft px-3.5 py-2.5">
            <p className="text-[13px] leading-snug text-tone-amber-text">
              {st.tokenDaysLeft <= 0
                ? "El token de Instagram venció: no entra ni sale nada."
                : `Al token le quedan ${st.tokenDaysLeft} días.`}
            </p>
            {isAdmin && (
              <Button size="sm" variant="secondary" onClick={renewToken} loading={refreshing}>
                <RefreshCw />
                Renovar token
              </Button>
            )}
          </div>
        )}
      </section>

      {isAdmin && (
        <>
          {/* ── El asistente ── */}
          <section className="card overflow-hidden p-0 animate-fade-in">
            <Step
              n={1}
              title="Los datos de Meta"
              description={
                <>
                  En{" "}
                  <Crumb parts={["Meta for Developers", "tu app", "Instagram"]} />, entrá a{" "}
                  <span className="font-medium text-ink">API setup with Instagram login</span>.
                  Ahí está todo lo de abajo.
                </>
              }
              done={credsListas}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <SecretField
                    id="ig-token"
                    label="Token de acceso"
                    value={token}
                    onChange={setToken}
                    loaded={st.hasToken}
                    loadedLabel={st.tokenTail ? `Cargado ····${st.tokenTail}` : "Cargado"}
                    placeholder={
                      st.hasToken ? "Dejalo vacío para no cambiarlo" : "IGAA… (pegalo entero)"
                    }
                    hint={
                      <>
                        En el paso{" "}
                        <span className="font-medium text-ink">Generate access tokens</span>,
                        tocá <span className="font-medium text-ink">Generate token</span> sobre
                        tu cuenta. Dura 60 días y el sistema lo renueva solo antes de que
                        venza.
                      </>
                    }
                  />
                </div>

                <IdField
                  id="ig-appid"
                  label="Instagram App ID"
                  value={igAppId}
                  onChange={setIgAppId}
                  placeholder="1234567890123456"
                  hint={
                    <>
                      Está en{" "}
                      <span className="font-medium text-ink">Business login settings</span>, en
                      esa misma pantalla. No es el App ID de la app de Meta.
                    </>
                  }
                />

                <SecretField
                  id="ig-appsecret"
                  label="Instagram App Secret"
                  value={igAppSecret}
                  onChange={setIgAppSecret}
                  loaded={st.hasIgAppSecret}
                  loadedLabel="Cargado"
                  placeholder={st.hasIgAppSecret ? "Dejalo vacío para no cambiarlo" : "32 caracteres"}
                  hint="Al lado del Instagram App ID. Es el que renueva el token."
                />

                <IdField
                  id="ig-metaappid"
                  label="App ID de Meta"
                  value={appId}
                  onChange={setAppId}
                  placeholder="1234567890123456"
                  hint={
                    <>
                      El de la app en sí:{" "}
                      <Crumb parts={["Configuración", "Básica"]} />. Opcional, pero ayuda al
                      diagnóstico.
                    </>
                  }
                />

                <SecretField
                  id="ig-metaappsecret"
                  label="App Secret de Meta"
                  value={appSecret}
                  onChange={setAppSecret}
                  loaded={st.hasAppSecret}
                  loadedLabel="Cargado"
                  placeholder={st.hasAppSecret ? "Dejalo vacío para no cambiarlo" : "32 caracteres"}
                  hint={
                    <>
                      En el mismo lugar que el App ID, tapado. Cargá los DOS secretos: Meta no
                      documenta con cuál firma los mensajes que nos manda, así que el sistema
                      prueba con los dos.
                    </>
                  }
                />
              </div>

              <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-sand-soft/60 px-3.5 py-2.5">
                <Lock className="mt-0.5 size-4 shrink-0 text-ink-faint" strokeWidth={1.9} aria-hidden />
                <p className="text-xs leading-relaxed text-ink-soft">
                  El token y los secretos se guardan cifrados. Una vez guardados no se pueden
                  volver a ver desde esta pantalla: los usa el sistema, y nada más que para
                  hablar con Meta.
                </p>
              </div>

              <div className="mt-4 flex justify-end">
                <Button
                  onClick={saveCreds}
                  loading={saving}
                  disabled={!credsDirty && credsListas}
                  size="lg"
                >
                  <ShieldCheck />
                  {credsDirty || !credsListas ? "Guardar y validar" : "Validar de nuevo"}
                </Button>
              </div>
            </Step>

            <Step
              n={2}
              title="Pegá esto en Meta"
              description={
                <>
                  Este paso es a mano y una sola vez: Instagram no deja configurar la
                  dirección del webhook por API. En{" "}
                  <span className="font-medium text-ink">API setup with Instagram login</span>,
                  paso <span className="font-medium text-ink">Configure webhooks</span>, pegá
                  estos dos valores y tildá el campo{" "}
                  <span className="font-medium text-ink">messages</span>.
                </>
              }
              done={st.webhookSubscribed}
            >
              {!credsListas ? (
                <p className="text-sm text-ink-faint">
                  Primero guardá los datos de Meta: el verify token lo genera el sistema.
                </p>
              ) : (
                <div className="space-y-3">
                  <CopyRow
                    label="Callback URL"
                    value={webhookUrl ?? st.webhookPath}
                    copyMessage="URL copiada."
                  />

                  {verifyToken ? (
                    <CopyRow
                      label="Verify token"
                      value={verifyToken}
                      copyMessage="Verify token copiado."
                    />
                  ) : (
                    <div className="rounded-xl border border-line bg-sand-soft/60 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-ink-faint">
                        Verify token
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="text-[13px] text-ink-soft">
                          Lo genera el sistema. Mostralo para copiarlo.
                        </p>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={reveal}
                          loading={revealing}
                          className="shrink-0"
                        >
                          <KeyRound />
                          Mostrar
                        </Button>
                      </div>
                    </div>
                  )}

                  {!webhookUrl && (
                    <p className="rounded-xl border border-tone-amber-line bg-tone-amber-soft px-3 py-2 text-[12px] leading-snug text-tone-amber-text">
                      Falta configurar la dirección pública del sistema
                      (NEXT_PUBLIC_APP_URL). Sin eso, Meta no sabe a dónde mandarnos los
                      mensajes.
                    </p>
                  )}
                </div>
              )}
            </Step>

            <Step
              n={3}
              title="Conectar"
              description="Le decimos a Meta que nos entregue los mensajes de esta cuenta. Es el paso que hace que las consultas entren solas."
              done={st.webhookSubscribed && st.checkOk === true}
            >
              {!credsListas ? (
                <p className="text-sm text-ink-faint">
                  Guardá los datos de arriba y este botón se prende.
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

          {/* ── Diagnóstico ── */}
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
                disabled={!st.hasToken}
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
                Todavía no revisamos nada. Guardá los datos de Meta y tocá Conectar: acá te
                vamos a decir, punto por punto, qué está bien y qué falta.
              </p>
            )}
          </section>
        </>
      )}

      {/* ── Respuesta automática ── */}
      {autoReplySection}

      {/* ── El puente a WhatsApp ── */}
      {isAdmin && (
        <section className="card p-5 animate-fade-in">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-wa-accent/15 text-wa-accent-deep">
                <WhatsAppIcon className="size-4.5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold text-ink">
                  Puente a WhatsApp
                </h2>
                <p className="text-sm leading-relaxed text-ink-soft">
                  La consulta entra por Instagram y termina en WhatsApp, con la misma persona
                  y el mismo lead. Sin duplicados.
                </p>
              </div>
            </div>
            <Switch
              checked={bridgeOn}
              onCheckedChange={setBridgeOn}
              aria-label="Activar el puente a WhatsApp"
            />
          </div>

          <div className={cn("mt-4 space-y-4", !bridgeOn && "opacity-60")}>
            <div>
              <Label htmlFor="ig-bridge-number">¿A qué WhatsApp lo mandamos?</Label>
              <Select
                id="ig-bridge-number"
                value={bridgeMode}
                onChange={(e) => setBridgeMode(e.target.value)}
                disabled={!bridgeOn}
              >
                <option value={AUTO_PHONE}>
                  Automático — el número de la sucursal que atiende
                </option>
                {waNumbers.map((n) => (
                  <option key={n.phone} value={n.phone}>
                    {n.label} · {fmtPhone(n.phone)}
                  </option>
                ))}
                <option value={OTHER_PHONE}>Otro número…</option>
              </Select>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                {bridgeMode === AUTO_PHONE
                  ? "Cae directo en el WhatsApp del vendedor que le toca: sin ventana de 24 hs y sin pasar por el número madre."
                  : "Todas las consultas de Instagram van a este número."}
              </p>
              {bridgeMode === OTHER_PHONE && (
                <Input
                  value={bridgePhone}
                  onChange={(e) => setBridgePhone(e.target.value.replace(/\D/g, ""))}
                  placeholder="5493815554433"
                  inputMode="tel"
                  disabled={!bridgeOn}
                  className="mt-2 h-11 tabular-nums"
                />
              )}
              {waNumbers.length === 0 && (
                <p className="mt-2 rounded-xl border border-tone-amber-line bg-tone-amber-soft px-3 py-2 text-[12px] leading-snug text-tone-amber-text">
                  Todavía no hay ningún WhatsApp vinculado en el sistema. Vinculá el de una
                  sucursal o cargá un número acá para que el puente funcione.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ig-bridge-label">Texto del link</Label>
                <Input
                  id="ig-bridge-label"
                  value={bridgeLabel}
                  onChange={(e) => setBridgeLabel(e.target.value)}
                  placeholder="Escribinos por WhatsApp"
                  maxLength={60}
                  disabled={!bridgeOn}
                  className="h-11"
                />
              </div>
              <div>
                <Label htmlFor="ig-bridge-text">Lo que le queda escrito</Label>
                <Input
                  id="ig-bridge-text"
                  value={bridgeText}
                  onChange={(e) => setBridgeText(e.target.value)}
                  placeholder="¡Hola! Les escribo desde Instagram."
                  maxLength={200}
                  disabled={!bridgeOn}
                  className="h-11"
                />
              </div>
            </div>
            <p className="text-xs leading-relaxed text-ink-faint">
              Al texto se le agrega una referencia corta (Ref. IG-…). Es lo que hace que,
              cuando escriba por WhatsApp, el sistema sepa que es la misma persona del DM y
              siga en el mismo lead.
            </p>

            {/* El otro sentido del puente */}
            <div className="rounded-2xl border border-line bg-sand-soft/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    Escribirle primero, sin esperar a nadie
                  </p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">
                    Si deja su teléfono en el DM (escrito o con el botón), el sistema le manda
                    un WhatsApp desde el número de la sucursal en el acto.
                  </p>
                </div>
                <Switch
                  checked={autoWa}
                  onCheckedChange={setAutoWa}
                  disabled={!bridgeOn}
                  aria-label="Escribirle por WhatsApp automáticamente"
                />
              </div>

              <div className={cn("mt-3", !autoWa && "opacity-60")}>
                <Label htmlFor="ig-autowa">Mensaje que sale</Label>
                <Textarea
                  id="ig-autowa"
                  value={autoWaText}
                  onChange={(e) => setAutoWaText(e.target.value)}
                  rows={3}
                  disabled={!bridgeOn || !autoWa}
                  className="min-h-[80px]"
                />
                <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                  Podés usar <code className="font-mono">{"{{nombre}}"}</code> y{" "}
                  <code className="font-mono">{"{{agencia}}"}</code>. Viene apagado a
                  propósito: que un negocio te escriba solo a un número que soltaste al pasar
                  es una decisión del dueño.
                </p>
              </div>
            </div>

          </div>

          {/* Fuera de las 24 hs. Va acá y no en el puente porque es lo otro que
              se puede hacer cuando la ventana se cierra — y hoy es la única
              alternativa a WhatsApp que ofrece Instagram. */}
          <div className="mt-4 border-t border-line pt-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  Contestar hasta 7 días después
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">
                  Instagram deja responder fuera de las 24 hs solo con la etiqueta de{" "}
                  <span className="font-medium text-ink">agente humano</span>, y hay que
                  pedirla en App Review (Meta for Developers, Revisión de la app, Permisos y
                  funciones, Human Agent). Prendelo recién cuando te la aprueben: si no, Meta
                  rechaza el envío.
                </p>
              </div>
              <Switch
                checked={humanAgent}
                onCheckedChange={setHumanAgent}
                aria-label="Tengo aprobada la etiqueta de agente humano"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button onClick={saveBridge} loading={savingBridge} disabled={!bridgeDirty}>
              Guardar cambios
            </Button>
          </div>
        </section>
      )}

      {!isAdmin && (
        <p className="px-1 text-xs text-ink-faint">
          La conexión con Instagram la maneja un admin de la agencia.
        </p>
      )}

      {/* ── Webhook (referencia) y desconectar ── */}
      {isAdmin && st.hasToken && (
        <>
          <section className="card p-5 animate-fade-in">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text">
                <Webhook className="size-4.5" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold text-ink">Webhook</h2>
                <p className="text-sm leading-relaxed text-ink-soft">
                  Es la puerta por donde Meta le pasa al sistema los mensajes de tu Instagram.
                  Esta dirección es la de tu agencia; se carga una sola vez en el panel de
                  Meta y no se toca más.
                </p>
              </div>
            </div>
            <div className="mt-4">
              <CopyRow
                label="Callback URL"
                value={webhookUrl ?? st.webhookPath}
                copyMessage="URL copiada."
              />
            </div>
          </section>

          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={() => setDisconnectOpen(true)}
              className="inline-flex h-11 items-center gap-2 rounded-xl px-3 text-[13px] font-medium text-ink-faint transition-colors hover:bg-tone-red-soft hover:text-tone-red-text tap-highlight-none active:scale-[0.98]"
            >
              <Unplug className="size-4" strokeWidth={1.9} aria-hidden />
              Desconectar la cuenta de Instagram
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="¿Desconectar la cuenta de Instagram?"
        description="Dejan de entrar los mensajes directos. Los chats y los leads quedan como están. Para volver a conectarla vas a tener que cargar el token otra vez."
        confirmLabel="Desconectar"
        onConfirm={disconnect}
      />
    </div>
  );
}
