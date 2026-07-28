"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronRight,
  QrCode,
  RefreshCw,
  Smartphone,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/config/confirm-dialog";
import { getChannelState, linkChannel, syncChannel, unlinkChannel } from "@/lib/actions/branches";
import { fmtPhone, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Enums } from "@/lib/types";

/** Lo que la card necesita saber del número (ChannelState + el nombre visible). */
export type ChannelCard = {
  id: string;
  label: string;
  phone: string | null;
  status: Enums<"wa_channel_status">;
  qr: string | null;
  qrExpiresAt: string | null;
  lastError: string | null;
  lastConnectedAt: string | null;
};

const POLL_MS = 2_000;
/** Después de 2 minutos sin escanear, cortamos y ofrecemos generar otro código. */
const POLL_MAX_MS = 120_000;

const STATUS_META: Record<
  Enums<"wa_channel_status">,
  { title: string; dot: string; chip: string }
> = {
  conectado: {
    title: "Conectado",
    dot: "bg-wa-accent ring-4 ring-wa-accent/15 animate-pulse-dot",
    chip: "border-tone-emerald-line bg-tone-emerald-soft text-tone-emerald-text",
  },
  vinculando: {
    title: "Escaneá el QR",
    dot: "bg-amber-500 ring-4 ring-tone-amber-soft animate-pulse-dot",
    chip: "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
  },
  desconectado: {
    title: "Sin vincular",
    dot: "bg-stone-400 ring-4 ring-tone-stone-soft",
    chip: "border-tone-stone-line bg-tone-stone-soft text-tone-stone-text",
  },
  error: {
    title: "Con problemas",
    dot: "bg-red-500 ring-4 ring-tone-red-soft",
    chip: "border-tone-red-line bg-tone-red-soft text-tone-red-text",
  },
};

/** Miga de pan inline para los pasos ("Ajustes → Dispositivos vinculados"). */
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

/**
 * Vincular el número de una sucursal escaneando el QR (sesión de Baileys).
 * Mientras el estado es "vinculando" pollea `getChannelState` cada 2 s: refresca
 * el QR y detecta el momento exacto en que el teléfono lo escanea.
 */
export function ChannelLinkCard({
  channel,
  workerReady,
  isAdmin,
  className,
}: {
  channel: ChannelCard;
  workerReady: boolean;
  isAdmin: boolean;
  className?: string;
}) {
  const router = useRouter();
  // lo que trajimos polleando pisa lo que vino del server (siempre es más nuevo)
  const [live, setLive] = React.useState<Partial<ChannelCard>>({});
  const [timedOut, setTimedOut] = React.useState(false);
  const [pollFailed, setPollFailed] = React.useState(false);
  const [linking, setLinking] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [unlinkOpen, setUnlinkOpen] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  const state: ChannelCard = { ...channel, ...live };
  const { id: channelId, label } = channel;
  // el QR y su seguimiento son cosa de admin: al resto ni le llega el código
  const polling =
    isAdmin && workerReady && state.status === "vinculando" && !timedOut && !pollFailed;

  /* Polling mientras se escanea. Se corta solo al conectar, al fallar,
     cuando se agota el tiempo y al desmontar la card. */
  React.useEffect(() => {
    if (!polling) return;
    const deadline = Date.now() + POLL_MAX_MS;
    let alive = true;

    const timer = window.setInterval(async () => {
      try {
        const res = await getChannelState({ channelId });
        if (!alive) return;
        if (!res.ok) {
          setPollFailed(true);
          toast.error(res.error);
          return;
        }
        setLive(res.data);
        if (res.data.status === "conectado") {
          toast.success(`${label} quedó vinculado.`);
          router.refresh();
          return;
        }
        if (res.data.status === "error") {
          toast.error(res.data.lastError ?? "No se pudo vincular el número.");
          return;
        }
        if (Date.now() > deadline) setTimedOut(true);
      } catch {
        // si se cae la red el intervalo quedaría girando en el vacío: cortamos
        if (!alive) return;
        setPollFailed(true);
        toast.error("Perdimos la conexión. Tocá Actualizar estado cuando vuelva.");
      }
    }, POLL_MS);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [polling, channelId, label, router]);

  // reloj de 1 s solo mientras hay un QR en pantalla (para marcarlo vencido)
  const hasQr = isAdmin && Boolean(state.qr) && state.status === "vinculando";
  React.useEffect(() => {
    if (!hasQr) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasQr]);

  const qrExpired = Boolean(state.qrExpiresAt && new Date(state.qrExpiresAt).getTime() <= now);
  const meta = STATUS_META[state.status] ?? STATUS_META.desconectado;

  async function link() {
    setLinking(true);
    setTimedOut(false);
    setPollFailed(false);
    try {
      const res = await linkChannel({ channelId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setLive(res.data);
      setNow(Date.now());
    } catch {
      toast.error("No se pudo pedir el código. Revisá tu conexión y probá de nuevo.");
    } finally {
      setLinking(false);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      const res = await syncChannel({ channelId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setLive(res.data);
      setTimedOut(false);
      setPollFailed(false);
      setNow(Date.now());
      toast.success("Estado actualizado.");
      router.refresh();
    } catch {
      toast.error("No se pudo actualizar el estado. Revisá tu conexión y probá de nuevo.");
    } finally {
      setSyncing(false);
    }
  }

  async function unlink() {
    try {
      const res = await unlinkChannel({ channelId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setLive({
        status: "desconectado",
        qr: null,
        qrExpiresAt: null,
        phone: null,
        lastError: null,
      });
      setTimedOut(false);
      setPollFailed(false);
      setUnlinkOpen(false);
      toast.success("Número desvinculado.");
      router.refresh();
    } catch {
      toast.error("No se pudo desvincular. Revisá tu conexión y probá de nuevo.");
    }
  }

  return (
    <div className={cn("rounded-2xl border border-line bg-sand-soft/50 p-4", className)}>
      {/* Estado */}
      <div className="flex items-start gap-3">
        <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", meta.dot)} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-semibold text-ink">{meta.title}</p>
            {state.status === "conectado" && state.phone && (
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
                  meta.chip,
                )}
              >
                {fmtPhone(state.phone)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">
            {state.status === "conectado" ? (
              <>
                Manda y recibe desde este número, sin ventana de 24 horas.
                {state.lastConnectedAt ? ` Vinculado ${fmtRelative(state.lastConnectedAt)}.` : ""}
              </>
            ) : state.status === "vinculando" ? (
              isAdmin ? (
                "Escaneá el código con el celular de la sucursal. Queda vinculado en segundos."
              ) : (
                "Un admin lo está vinculando. En un rato queda listo para usar."
              )
            ) : state.status === "error" ? (
              (state.lastError ??
                (isAdmin
                  ? "El número se desconectó. Probá vincularlo de nuevo."
                  : "El número se desconectó. Un admin lo tiene que vincular de nuevo."))
            ) : isAdmin ? (
              "Vinculá el WhatsApp de la sucursal para que el operador le escriba al cliente desde su propio número."
            ) : (
              "Todavía no tiene WhatsApp propio. Lo vincula un admin de la agencia."
            )}
          </p>
        </div>
      </div>

      {!workerReady ? (
        /* Sin worker no hay sesión posible: lo decimos claro y sin alarmar.
           El detalle técnico (variables del servidor) es solo para el admin. */
        isAdmin ? (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-tone-amber-line bg-tone-amber-soft px-3.5 py-3">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-tone-amber-text"
              strokeWidth={1.9}
              aria-hidden
            />
            <div className="min-w-0 text-[13px] leading-relaxed text-tone-amber-text">
              <p className="font-medium">Falta levantar el worker de WhatsApp.</p>
              <p className="mt-0.5">
                Es el proceso que mantiene abierta la sesión del número. Cargá las variables{" "}
                <code className="rounded bg-paper/60 px-1 py-0.5 font-mono text-[11px]">
                  WA_WORKER_URL
                </code>{" "}
                y{" "}
                <code className="rounded bg-paper/60 px-1 py-0.5 font-mono text-[11px]">
                  WA_WORKER_TOKEN
                </code>{" "}
                y volvé a entrar. Mientras tanto los mensajes se registran igual en el sistema,
                pero no salen.
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
            El WhatsApp de la sucursal todavía no está funcionando. Lo deja listo un admin de la
            agencia; mientras tanto tus mensajes se guardan en el sistema pero no salen.
          </p>
        )
      ) : (
        <>
          {/* El QR es el protagonista. Solo lo ve el admin: quien lo escanea se
              queda con el WhatsApp de la sucursal. */}
          {isAdmin && state.status === "vinculando" && (
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start animate-slide-up">
              <div className="flex flex-col items-center gap-2">
                {state.qr ? (
                  <>
                    {/* fondo blanco fijo: es una imagen que la cámara tiene que leer */}
                    <div
                      className={cn(
                        "rounded-2xl border border-line bg-white p-3 shadow-sm transition-opacity",
                        qrExpired && "opacity-30",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={state.qr}
                        alt="Código QR para vincular el WhatsApp de la sucursal"
                        className="size-[196px] max-w-full sm:size-[208px]"
                      />
                    </div>
                    {qrExpired && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={link}
                        loading={linking}
                        className="h-11 sm:h-8"
                      >
                        <RefreshCw />
                        Generar otro
                      </Button>
                    )}
                  </>
                ) : (
                  <div className="flex size-[196px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong bg-paper sm:size-[208px]">
                    <QrCode className="size-7 text-ink-faint" strokeWidth={1.75} aria-hidden />
                    <p className="px-4 text-center text-xs text-ink-faint">Generando el código…</p>
                  </div>
                )}
              </div>

              <ol className="min-w-0 flex-1 space-y-2.5">
                {[
                  <React.Fragment key="s1">
                    Abrí <span className="font-medium text-ink">WhatsApp</span> en el celular de la
                    sucursal.
                  </React.Fragment>,
                  <React.Fragment key="s2">
                    Entrá a <Crumb parts={["Ajustes", "Dispositivos vinculados"]} />.
                  </React.Fragment>,
                  <React.Fragment key="s3">
                    Tocá <span className="font-medium text-ink">Vincular un dispositivo</span> y
                    escaneá este código.
                  </React.Fragment>,
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-cream">
                      {i + 1}
                    </span>
                    <p className="text-[13px] leading-relaxed text-ink-soft">{step}</p>
                  </li>
                ))}
                {polling ? (
                  <li className="flex items-center gap-2 pt-0.5 text-[12px] text-ink-faint">
                    <Smartphone className="size-3.5" aria-hidden />
                    Esperando el escaneo…
                  </li>
                ) : (
                  <li className="rounded-xl border border-line bg-paper px-3 py-2.5 text-[13px] leading-relaxed text-ink-soft">
                    {pollFailed
                      ? "Perdimos el estado del número. Tocá Actualizar estado o generá un código nuevo."
                      : "Pasó un rato sin escanear. Generá un código nuevo cuando tengas el celular a mano."}
                  </li>
                )}
              </ol>
            </div>
          )}

          {/* Acciones */}
          {isAdmin ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {state.status === "conectado" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setUnlinkOpen(true)}
                  className="h-11 text-tone-red-text sm:h-8"
                >
                  <Unplug />
                  Desvincular
                </Button>
              ) : state.status === "vinculando" ? (
                <>
                  {!polling && (
                    <Button size="sm" onClick={link} loading={linking} className="h-11 sm:h-8">
                      <RefreshCw />
                      Generar otro código
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setUnlinkOpen(true)}
                    className="h-11 sm:h-8"
                  >
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="whatsapp"
                  onClick={link}
                  loading={linking}
                  className="h-11 sm:h-8"
                >
                  <QrCode />
                  {state.status === "error" ? "Vincular de nuevo" : "Vincular número"}
                </Button>
              )}

              <Button
                size="sm"
                variant="ghost"
                onClick={sync}
                loading={syncing}
                className="h-11 sm:h-8"
              >
                <RefreshCw />
                Actualizar estado
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-ink-faint">
              Los números los vincula un admin de la agencia.
            </p>
          )}
        </>
      )}

      <ConfirmDialog
        open={unlinkOpen}
        onOpenChange={setUnlinkOpen}
        title={`¿Desvincular ${label}?`}
        description="El número deja de recibir y de enviar mensajes desde el sistema. Para volver a usarlo hay que escanear el QR otra vez."
        confirmLabel="Desvincular"
        onConfirm={unlink}
      />
    </div>
  );
}
