"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Banknote,
  Building2,
  CalendarClock,
  Check,
  Clock,
  MessageSquareText,
  Plus,
  RefreshCw,
  Send,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { AnimatedNumber, EmptyState, Segmented } from "@/components/ui/misc";
import { TemplateDialog } from "@/components/config/template-dialog";
import { parseTemplateButtons } from "@/lib/templates";
import {
  AudiencePicker,
  type ContactStats,
  type PickerBranch,
  type PickerMember,
  type PickerTag,
} from "@/components/difusiones/audience-picker";
import { WaPreview } from "@/components/difusiones/wa-preview";
import { fmtDate, fmtNumber, fmtPhone, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BroadcastAudience, BroadcastIntent, Tables } from "@/lib/types";
import {
  AUDIENCE_PRESETS,
  BROADCAST_VAR_KEYS,
  EMPTY_AUDIENCE,
  buildRecipientVars,
  type AudienceRow,
} from "@/lib/broadcasts/audience";
import { launchBroadcast, previewAudience, saveBroadcast } from "@/lib/actions/broadcasts";
import { syncTemplatesFromMeta } from "@/lib/actions/templates";

type Template = Tables<"wa_templates">;

/**
 * Un borrador que se retoma. Lo trae el RSC cuando la URL llega con `?id=`, que
 * es a donde apunta "Seguir armando" desde la pantalla de la difusión.
 */
export type BroadcastDraft = {
  id: string;
  name: string;
  templateId: string;
  audience: BroadcastAudience;
  branchId: string | null;
  scheduledAt: string | null;
  throttlePerRun: number;
};

/** El cron de difusiones corre cada 5 minutos: de ahí sale el "cuánto tarda". */
const MINUTOS_POR_TANDA = 5;

const RITMOS = [
  { value: "30", label: "Tranquilo" },
  { value: "60", label: "Normal" },
  { value: "120", label: "Rápido" },
];

const INTENCIONES: Record<BroadcastIntent, { label: string; chip: string; detalle: string }> = {
  interesado: {
    label: "Interesado",
    chip: "border-tone-emerald-line bg-tone-emerald-soft text-tone-emerald-text",
    detalle: "se abre el chat, el lead queda marcado como interesado y la sucursal recibe el aviso.",
  },
  tal_vez: {
    label: "Tal vez",
    chip: "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
    detalle: "queda anotado como tibio, para volver a buscarlo más adelante.",
  },
  baja: {
    label: "Se da de baja",
    chip: "border-tone-stone-line bg-tone-stone-soft text-tone-stone-text",
    detalle: "se da de baja solo y no le vuelve a llegar ninguna difusión.",
  },
};

/**
 * Armar una difusión: un solo scroll, tres pasos y una barra abajo que siempre
 * dice a cuánta gente le va a llegar.
 *
 * El orden no es caprichoso: primero se ve a quiénes (con nombres y caras),
 * después qué les llega (con la burbuja real), y recién al final cuándo sale.
 * Es plata de verdad y no se puede deshacer, así que el disparo pide
 * confirmación con los números a la vista.
 */
export function BroadcastComposer({
  templates: templatesIniciales,
  tags,
  branches,
  members,
  mother,
  agencyName,
  sellerName,
  dailyCap,
  dailyLeft,
  draft,
  stats,
}: {
  templates: Template[];
  tags: PickerTag[];
  branches: PickerBranch[];
  members: PickerMember[];
  mother: { connected: boolean; phone: string | null };
  agencyName: string;
  /** con qué nombre sale {{vendedor}}: el de quien dispara, igual que en la action */
  sellerName: string;
  /** tope diario de envíos de la agencia (agencies.settings.broadcast_daily_cap) */
  dailyCap: number;
  /** cuánto queda de ese tope hoy: el despachador ya descontó lo que salió */
  dailyLeft: number;
  /** borrador que se está retomando, si la URL trajo un `?id=` */
  draft: BroadcastDraft | null;
  stats: ContactStats;
}) {
  const router = useRouter();

  const [templates, setTemplates] = React.useState(templatesIniciales);
  const [templateId, setTemplateId] = React.useState<string | null>(draft?.templateId ?? null);
  const [templateDialogOpen, setTemplateDialogOpen] = React.useState(false);
  const [sincronizando, setSincronizando] = React.useState(false);
  // el editor de plantillas arranca su estado en el primer render: sin una key
  // nueva, la segunda vez que se abre aparece con lo que quedó de la anterior
  const [templateDialogSeq, setTemplateDialogSeq] = React.useState(0);

  const [audience, setAudience] = React.useState<BroadcastAudience>(
    draft?.audience ?? EMPTY_AUDIENCE,
  );
  const [presetKey, setPresetKey] = React.useState<string | null>(null);

  const [branchId, setBranchId] = React.useState<string | null>(draft?.branchId ?? null);
  const [cuando, setCuando] = React.useState<"ahora" | "programar">(
    draft?.scheduledAt ? "programar" : "ahora",
  );
  const [scheduledAt, setScheduledAt] = React.useState(paraInputLocal(draft?.scheduledAt));
  const [throttle, setThrottle] = React.useState(draft?.throttlePerRun ?? 60);
  const [nombre, setNombre] = React.useState(draft?.name ?? "");
  // el nombre del borrador ya lo eligió una persona: no se pisa con el del preset
  const [nombreTocado, setNombreTocado] = React.useState(Boolean(draft));

  const [total, setTotal] = React.useState<number | null>(null);
  const [sample, setSample] = React.useState<AudienceRow[]>([]);
  const [protectedCount, setProtectedCount] = React.useState<number | null>(null);
  const [cargando, setCargando] = React.useState(false);
  const [errorAudiencia, setErrorAudiencia] = React.useState<string | null>(null);
  const [intento, setIntento] = React.useState(0);

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [guardando, setGuardando] = React.useState(false);
  /* Retomar un borrador guarda SOBRE ese mismo id. Sin esto, "Seguir armando"
     creaba una difusión nueva cada vez y el borrador original quedaba huérfano
     en la lista, sin manera de retomarlo. */
  const [draftId, setDraftId] = React.useState<string | null>(draft?.id ?? null);

  const seqRef = React.useRef(0);

  const aprobadas = React.useMemo(
    () => templates.filter((t) => t.meta_status === "APPROVED"),
    [templates],
  );
  const pendientes = React.useMemo(
    () => templates.filter((t) => t.meta_status !== "APPROVED").length,
    [templates],
  );

  const plantilla = React.useMemo(
    () => aprobadas.find((t) => t.id === templateId) ?? null,
    [aprobadas, templateId],
  );
  const botones = React.useMemo(() => parseTemplateButtons(plantilla?.buttons), [plantilla]);

  /* Contador en vivo. La segunda consulta pide lo mismo pero sin las
     protecciones: la diferencia es, exacta, cuánta gente estamos cuidando.
     Si esa consulta falla no se inventa el número — se explica con palabras. */
  const protecciones = (audience.skip_active ?? true) || (audience.no_broadcast_days ?? 7) > 0;
  const puedeArmar = mother.connected && aprobadas.length > 0;

  React.useEffect(() => {
    if (!puedeArmar) return; // sin número madre o sin plantillas no hay nada que medir
    const seq = ++seqRef.current;
    const t = setTimeout(async () => {
      // el "cargando" arranca recién cuando arranca la consulta: mientras corre
      // el debounce el número anterior sigue firme, sin parpadear a cada tecla
      setCargando(true);
      const [principal, crudo] = await Promise.all([
        previewAudience({ audience }),
        protecciones
          ? previewAudience({
              audience: { ...audience, skip_active: false, no_broadcast_days: 0 },
            })
          : Promise.resolve(null),
      ]);
      if (seq !== seqRef.current) return; // llegó tarde: ya hay otra medición
      setCargando(false);
      if (!principal.ok) {
        setErrorAudiencia(principal.error);
        return;
      }
      setErrorAudiencia(null);
      setTotal(principal.data.total);
      setSample(principal.data.sample);
      setProtectedCount(
        crudo && crudo.ok ? Math.max(0, crudo.data.total - principal.data.total) : null,
      );
    }, 350);
    return () => clearTimeout(t);
  }, [audience, protecciones, intento, puedeArmar]);

  function aplicarPreset(key: string) {
    const preset = AUDIENCE_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setPresetKey(key);
    setAudience((a) => {
      // las protecciones son del envío, no del grupo: cambiar de preset no
      // tiene por qué volver a prender algo que el usuario apagó a propósito
      const next: BroadcastAudience = { ...preset.filters };
      if (a.skip_active !== undefined) next.skip_active = a.skip_active;
      if (a.no_broadcast_days !== undefined) next.no_broadcast_days = a.no_broadcast_days;
      return next;
    });
    if (!nombreTocado) setNombre(preset.label);
  }

  function cambiarFiltros(patch: Partial<BroadcastAudience>) {
    setPresetKey(null);
    setAudience((a) => ({ ...a, ...patch }));
  }

  function cambiarCuidado(patch: Partial<BroadcastAudience>) {
    setAudience((a) => ({ ...a, ...patch }));
  }

  function elegirPlantilla(id: string) {
    setTemplateId(id);
    if (!nombreTocado && !presetKey) {
      const t = templates.find((x) => x.id === id);
      if (t) setNombre(t.name);
    }
  }

  function abrirPlantillaNueva() {
    setTemplateDialogSeq((s) => s + 1);
    setTemplateDialogOpen(true);
  }

  function plantillaGuardada(t: Template) {
    setTemplates((prev) => {
      const otras = prev.filter((p) => p.id !== t.id);
      return [...otras, t].sort((a, b) => a.name.localeCompare(b.name, "es-AR"));
    });
    if (t.meta_status === "APPROVED") elegirPlantilla(t.id);
    else if (t.meta_status === "PENDING") {
      toast.success(`Mandaste "${t.name}" a Meta. Cuando la apruebe la vas a ver acá.`);
    }
  }

  /** Le pregunta a Meta si ya resolvió las plantillas que están en revisión. */
  async function buscarNovedades() {
    setSincronizando(true);
    const res = await syncTemplatesFromMeta();
    setSincronizando(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (res.data.actualizadas === 0 && res.data.nuevas === 0) {
      toast.success("Todavía no hay novedades. Meta suele tardar unos minutos.");
      return;
    }
    router.refresh();
  }

  /* ── estados vacíos: sin infraestructura no hay difusión que valga ── */

  if (!mother.connected) {
    return (
      <div className="px-4 md:px-6">
        <EmptyState
          icon={Unplug}
          title="Todavía no hay número madre conectado"
          description="Las difusiones salen desde el número de la Cloud API de Meta. Se conecta una sola vez y después esta pantalla queda lista."
          action={
            <Link href="/config/whatsapp" className={buttonVariants({ variant: "primary" })}>
              Conectar el número
            </Link>
          }
        />
      </div>
    );
  }

  if (aprobadas.length === 0) {
    return (
      <div className="px-4 md:px-6">
        <EmptyState
          icon={MessageSquareText}
          title="No hay ninguna plantilla aprobada"
          description={
            pendientes > 0
              ? "Tenés plantillas esperando el visto bueno de Meta. Cuando alguna quede aprobada podés difundirla desde acá — el estado no llega solo, hay que preguntarle."
              : "Para escribirle a alguien que no te habló primero, Meta pide una plantilla aprobada. Creá una y mandala a aprobar: suele tardar unos minutos."
          }
          action={
            <div className="flex flex-col-reverse items-center gap-2 sm:flex-row">
              {pendientes > 0 ? (
                /* El `meta_status` solo se refresca a mano. Sin este botón, la
                   plantilla se aprobaba a los cinco minutos y esta pantalla
                   seguía diciendo que no había ninguna, para siempre, salvo que
                   alguien adivinara que tenía que ir a Configuración. */
                <Button variant="secondary" loading={sincronizando} onClick={buscarNovedades}>
                  <RefreshCw />
                  Buscar novedades en Meta
                </Button>
              ) : (
                <Link
                  href="/config/plantillas"
                  className={buttonVariants({ variant: "secondary" })}
                >
                  Ver mis plantillas
                </Link>
              )}
              <Button onClick={abrirPlantillaNueva}>
                <Plus />
                Crear plantilla
              </Button>
            </div>
          }
        />
        <TemplateDialog
          key={`tpl-vacio-${templateDialogSeq}`}
          open={templateDialogOpen}
          onOpenChange={setTemplateDialogOpen}
          template={null}
          onSaved={plantillaGuardada}
          emphasis="meta"
        />
      </div>
    );
  }

  /* ── números del disparo ── */

  const destinatarios = total ?? 0;
  /* Contra lo que QUEDA del cupo, no contra el cupo entero: si a las 9 salieron
     200 de los 250 del día, a las 17 no salen otras 200. Es el mismo número que
     usa el despachador para decidir. */
  const hoy = Math.min(destinatarios, dailyLeft);
  const tandas = hoy > 0 ? Math.ceil(hoy / throttle) : 0;
  const minutos = Math.max(MINUTOS_POR_TANDA, tandas * MINUTOS_POR_TANDA);
  const excedeCupo = destinatarios > dailyLeft;
  const cupoYaUsado = dailyLeft < dailyCap;

  /* La vista previa se arma con el MISMO helper que usa el disparo: si acá se
     ve bien, sale bien. Y las variables que faltan se ven antes de apretar, no
     en el error de Meta —que rechaza los mil mensajes juntos. */
  const muestra = sample[0] ?? null;
  const variablesCuerpo = variablesDe(plantilla?.body);
  const headerConVariables = /\{\{\w+\}\}/.test(plantilla?.header_text ?? "");
  const armado = buildRecipientVars({
    variables: variablesDe(plantilla?.header_text, plantilla?.body, plantilla?.footer_text),
    fullName: muestra?.fullName ?? null,
    lastDestination: muestra?.lastDestination ?? null,
    agencyName,
    sellerName,
  });
  const variablesHuerfanas = armado.missing.filter((v) => variablesCuerpo.includes(v));

  // sin nombre propio se guarda con el de la plantilla: nadie debería frenar
  // acá por un campo administrativo (la action lo pide de 2 a 80 caracteres)
  const nombreFinal = (nombre.trim() || plantilla?.name || "").slice(0, 80);

  const listo =
    plantilla !== null &&
    total !== null &&
    destinatarios > 0 &&
    errorAudiencia === null &&
    !headerConVariables &&
    variablesHuerfanas.length === 0;

  /* Lo que falta para poder disparar, en el orden en que conviene resolverlo. */
  const motivoBloqueo = errorAudiencia
    ? "No se pudo calcular a quiénes les llega."
    : !plantilla
      ? "Elegí la plantilla que les va a llegar."
      : headerConVariables
        ? "El encabezado de la plantilla usa variables."
        : variablesHuerfanas.length > 0
          ? "La plantilla usa variables que la difusión no puede completar."
          : total === null
            ? "Calculando a quiénes les llega…"
            : destinatarios === 0
              ? "Con estos filtros no queda nadie."
              : null;

  function fechaProgramada(): { iso: string; error: string | null } {
    if (cuando === "ahora") return { iso: "", error: null };
    if (!scheduledAt) return { iso: "", error: "Elegí el día y la hora." };
    const d = new Date(scheduledAt);
    if (Number.isNaN(d.getTime())) return { iso: "", error: "Esa fecha no se entiende." };
    // un minuto de gracia, igual que la action: entre elegir la hora y apretar pasa tiempo
    if (d.getTime() < Date.now() - 60_000) {
      return { iso: "", error: "Esa hora ya pasó. Elegí una más adelante o mandala ahora." };
    }
    return { iso: d.toISOString(), error: null };
  }

  function abrirConfirmacion() {
    if (!listo) {
      if (motivoBloqueo) toast.error(motivoBloqueo);
      return;
    }
    if (nombreFinal.length < 2) {
      toast.error("Ponele un nombre a la difusión para encontrarla después.");
      return;
    }
    const { error } = fechaProgramada();
    if (error) {
      toast.error(error);
      return;
    }
    setConfirmOpen(true);
  }

  async function persistir(scheduledIso: string | null) {
    if (!plantilla) return null;
    const res = await saveBroadcast({
      id: draftId ?? undefined,
      name: nombreFinal,
      templateId: plantilla.id,
      audience,
      branchId,
      scheduledAt: scheduledIso,
      throttlePerRun: throttle,
    });
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    // se recuerda el id para que reintentar no cree una difusión duplicada
    setDraftId(res.data.id);
    return res.data.id;
  }

  async function guardarBorrador() {
    if (!plantilla) {
      toast.error("Elegí la plantilla que les va a llegar.");
      return;
    }
    if (nombreFinal.length < 2) {
      toast.error("Ponele un nombre a la difusión para encontrarla después.");
      return;
    }
    setGuardando(true);
    const id = await persistir(null);
    setGuardando(false);
    if (!id) return;
    toast.success("Borrador guardado. Lo retomás cuando quieras.");
    router.push("/difusiones");
  }

  async function disparar() {
    const { iso, error } = fechaProgramada();
    if (error) {
      toast.error(error);
      return;
    }
    const programada = cuando === "programar" ? iso : null;
    setEnviando(true);
    const id = await persistir(programada);
    if (!id) {
      setEnviando(false);
      return;
    }
    const res = await launchBroadcast({ id, scheduledAt: programada });
    setEnviando(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setConfirmOpen(false);
    const gente = personas(res.data.total);
    toast.success(
      res.data.scheduled
        ? `Programada. Le va a llegar a ${gente}.`
        : `Ya está saliendo. Le llega a ${gente}.`,
    );
    router.push(`/difusiones/${id}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pb-2 md:px-6">
      {/* 1 · a quiénes */}
      <Paso n={1} title="A quiénes les llega" hint="Elegí un grupo o afinalo a mano.">
        <AudiencePicker
          audience={audience}
          presetKey={presetKey}
          onPreset={aplicarPreset}
          onFilters={cambiarFiltros}
          onCare={cambiarCuidado}
          tags={tags}
          branches={branches}
          members={members}
          total={total}
          sample={sample}
          loading={cargando}
          error={errorAudiencia}
          onRetry={() => setIntento((i) => i + 1)}
          protectedCount={protectedCount}
          stats={stats}
        />
      </Paso>

      {/* 2 · qué les decís */}
      <Paso
        n={2}
        title="Qué les decís"
        hint={
          mother.phone
            ? `Sale desde tu número madre ${fmtPhone(mother.phone)}.`
            : "Sale desde tu número madre."
        }
      >
        <div className="space-y-2">
          {aprobadas.map((t) => {
            const elegida = t.id === plantilla?.id;
            const bs = parseTemplateButtons(t.buttons);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => elegirPlantilla(t.id)}
                aria-pressed={elegida}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all duration-150 tap-highlight-none active:scale-[0.99]",
                  elegida
                    ? "border-brand-500 bg-brand-tint shadow-sm"
                    : "border-line bg-paper hover:border-line-strong hover:bg-sand-soft/50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full border",
                    elegida ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong",
                  )}
                >
                  {elegida && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{t.name}</span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-ink-faint">
                    {t.body}
                  </span>
                  {bs.length > 0 && (
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {bs.map((b, i) => (
                        <span
                          key={`${b.text}-${i}`}
                          className="rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] text-ink-soft"
                        >
                          {b.text}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={abrirPlantillaNueva}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong/70 py-2 text-[13px] font-medium text-ink-faint transition-colors hover:border-brand-300 hover:text-brand-text tap-highlight-none"
          >
            <Plus className="size-4" strokeWidth={2} />
            Crear plantilla nueva
          </button>
        </div>

        {plantilla && (
          <div className="mt-4 space-y-3 animate-fade-in">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {muestra ? `Así lo recibe ${muestra.fullName}` : "Así lo recibe el cliente"}
            </p>
            <WaPreview
              header={plantilla.header_text}
              body={plantilla.body}
              footer={plantilla.footer_text}
              buttons={botones}
              vars={armado.vars}
            />

            {headerConVariables && (
              <Aviso>
                El encabezado usa variables y la difusión todavía no las puede completar. Editá la
                plantilla y dejá el encabezado con texto fijo.
              </Aviso>
            )}

            {variablesHuerfanas.length > 0 && (
              <Aviso>
                La plantilla usa {variablesHuerfanas.map((v) => `{{${v}}}`).join(", ")} y la
                difusión no tiene con qué completarlo. Meta rechaza el envío entero si una variable
                llega vacía: las que sí puede llenar son{" "}
                {BROADCAST_VAR_KEYS.map((v) => `{{${v}}}`).join(", ")}.
              </Aviso>
            )}

            {botones.length > 0 ? (
              <ul className="space-y-1.5">
                {botones.map((b, i) => (
                  <li
                    key={`${b.text}-${i}`}
                    className="flex flex-wrap items-center gap-1.5 text-[12.5px] leading-snug text-ink-soft"
                  >
                    <span className="rounded-full border border-line bg-sand-soft px-2 py-0.5 text-[11px] font-medium text-ink">
                      {b.text}
                    </span>
                    {b.type === "url" ? (
                      <span className="text-ink-faint">abre un link y se va de WhatsApp.</span>
                    ) : b.intent ? (
                      <>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            INTENCIONES[b.intent].chip,
                          )}
                        >
                          {INTENCIONES[b.intent].label}
                        </span>
                        <span className="text-ink-faint">{INTENCIONES[b.intent].detalle}</span>
                      </>
                    ) : (
                      <span className="text-ink-faint">
                        abre el chat, sin marcar ninguna intención.
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] leading-snug text-ink-faint">
                Esta plantilla no tiene botones: quien conteste lo va a hacer escribiendo, y el
                mensaje entra al chat como cualquier otro.
              </p>
            )}

            <div>
              <Label htmlFor="dif-sucursal">
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="size-3.5 text-ink-faint" strokeWidth={1.9} />
                  Quien conteste, ¿a qué sucursal va?
                </span>
              </Label>
              <Select
                id="dif-sucursal"
                value={branchId ?? ""}
                onChange={(e) => setBranchId(e.target.value || null)}
              >
                <option value="">Como siempre (reglas de derivación)</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}
      </Paso>

      {/* 3 · cuándo */}
      <Paso n={3} title="Cuándo sale" hint="Podés mandarla ahora o dejarla lista para más tarde.">
        <div className="space-y-4">
          <Segmented
            value={cuando}
            onChange={setCuando}
            options={[
              { value: "ahora", label: "Ahora" },
              { value: "programar", label: "Programar" },
            ]}
            className="w-full [&>button]:flex-1"
          />

          {cuando === "programar" && (
            <div className="animate-slide-up">
              <Label htmlFor="dif-fecha">Día y hora</Label>
              <Input
                id="dif-fecha"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
          )}

          <div>
            <Label>Ritmo de salida</Label>
            <Segmented
              value={String(throttle)}
              onChange={(v) => setThrottle(Number(v))}
              options={RITMOS}
              className="w-full [&>button]:flex-1"
            />
            <p className="mt-1.5 text-[12px] leading-snug text-ink-faint">
              Sale de a {throttle} cada {MINUTOS_POR_TANDA} minutos. Ir despacio cuida la
              reputación del número.
            </p>
          </div>

          {excedeCupo && (
            <p className="flex items-start gap-2 rounded-xl border border-line bg-sand-soft/60 px-3 py-2.5 text-[12.5px] leading-snug text-ink-soft">
              <Clock className="mt-px size-4 shrink-0 text-ink-faint" strokeWidth={1.9} />
              <span>
                {dailyLeft === 0
                  ? `Hoy ya salieron los ${fmtNumber(dailyCap)} mensajes que permite Meta por día. Esta arranca mañana sola, sin que hagas nada.`
                  : `${cupoYaUsado ? `Hoy quedan ${fmtNumber(dailyLeft)} de los ${fmtNumber(dailyCap)} del día` : `Hoy salen hasta ${fmtNumber(dailyLeft)}`}. Las ${fmtNumber(destinatarios - dailyLeft)} restantes siguen mañana solas, sin que hagas nada.`}
              </span>
            </p>
          )}

          <div>
            <Label htmlFor="dif-nombre">Nombre (para encontrarla después)</Label>
            <Input
              id="dif-nombre"
              value={nombre}
              onChange={(e) => {
                setNombre(e.target.value);
                setNombreTocado(true);
              }}
              placeholder={plantilla?.name ?? "Ej: Promo Brasil septiembre"}
              maxLength={80}
            />
          </div>

          <Button
            variant="secondary"
            className="w-full"
            loading={guardando}
            disabled={enviando}
            onClick={guardarBorrador}
          >
            Guardar como borrador
          </Button>
        </div>
      </Paso>

      {/* barra de disparo: pegajosa arriba de los tabs, siempre con el número */}
      <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom)+8px)] z-30 md:bottom-4">
        <div className="card flex items-center gap-3 p-3 shadow-lg shadow-ink/10">
          <div className="min-w-0 flex-1">
            {motivoBloqueo ? (
              <p className="truncate text-[13px] text-ink-soft">{motivoBloqueo}</p>
            ) : (
              <>
                <p className="truncate text-[15px] font-semibold leading-tight text-ink">
                  Le llega a{" "}
                  <AnimatedNumber
                    value={destinatarios}
                    duration={300}
                    format={(n) => fmtNumber(n)}
                  />{" "}
                  {destinatarios === 1 ? "persona" : "personas"}
                </p>
                <p className="truncate text-[11.5px] text-ink-faint">
                  de a {throttle} cada {MINUTOS_POR_TANDA} min · listo en ~{fmtEta(minutos)}
                </p>
              </>
            )}
          </div>
          <Button
            variant="whatsapp"
            size="lg"
            className="shrink-0"
            disabled={!listo || enviando || guardando}
            onClick={abrirConfirmacion}
          >
            {cuando === "programar" ? <CalendarClock /> : <Send />}
            {cuando === "programar" ? "Programar" : "Mandar"}
          </Button>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(o) => !enviando && setConfirmOpen(o)}>
        <DialogContent
          title={cuando === "programar" ? "¿Dejamos la difusión programada?" : "¿Mandamos la difusión?"}
          description="Revisá los números antes de apretar: lo que sale, sale."
        >
          <div className="space-y-3">
            <div className="rounded-2xl border border-brand-tint-line bg-brand-tint p-4 text-center">
              <p className="font-display text-[34px] font-semibold leading-none text-ink tabular-nums">
                {fmtNumber(destinatarios)}
              </p>
              <p className="mt-1 text-[13px] text-ink-soft">
                {destinatarios === 1 ? "persona la va a recibir" : "personas la van a recibir"}
              </p>
            </div>

            <ul className="space-y-2">
              <ConfirmRow icon={MessageSquareText}>
                Sale la plantilla <span className="font-medium text-ink">{plantilla?.name}</span>
                {mother.phone ? ` desde ${fmtPhone(mother.phone)}` : ""}.
              </ConfirmRow>
              <ConfirmRow icon={Clock}>
                De a {throttle} cada {MINUTOS_POR_TANDA} minutos: la última sale en unos{" "}
                {fmtEta(minutos)}.
              </ConfirmRow>
              {excedeCupo && (
                <ConfirmRow icon={CalendarClock}>
                  {dailyLeft === 0
                    ? "Hoy ya se usó el cupo diario: arranca mañana."
                    : `Hoy salen ${fmtNumber(dailyLeft)} y el resto sigue mañana.`}
                </ConfirmRow>
              )}
              {cuando === "programar" && scheduledAt && (
                <ConfirmRow icon={CalendarClock}>
                  Empieza el{" "}
                  <span className="font-medium text-ink">{fmtCuando(scheduledAt)}</span>.
                </ConfirmRow>
              )}
              {/* Nadie debería enterarse de que esto se paga cuando le llega la
                  factura de Meta a fin de mes. */}
              <ConfirmRow icon={Banknote}>
                Cada mensaje de una difusión lo cobra Meta. El seguimiento de los que contesten
                sigue siendo gratis, desde la sucursal.
              </ConfirmRow>
              <ConfirmRow icon={TriangleAlert}>
                Podés cancelarla mientras está saliendo, pero lo que ya salió no se puede volver
                atrás.
              </ConfirmRow>
            </ul>

            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmOpen(false)}
                disabled={enviando}
              >
                Ahora no
              </Button>
              <Button type="button" variant="whatsapp" loading={enviando} onClick={disparar}>
                <Send />
                {cuando === "programar"
                  ? "Sí, dejala programada"
                  : `Sí, mandar a ${personas(destinatarios)}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TemplateDialog
        key={`tpl-${templateDialogSeq}`}
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        template={null}
        onSaved={plantillaGuardada}
        emphasis="meta"
      />
    </div>
  );
}

/* ───────────────────────── subcomponentes ───────────────────────── */

function Paso({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-4 sm:p-5 animate-slide-up">
      <div className="mb-3.5 flex items-start gap-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-cream">
          {n}
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold leading-tight text-ink">{title}</h2>
          {hint && <p className="mt-0.5 text-[12.5px] leading-snug text-ink-soft">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-tone-amber-line bg-tone-amber-soft px-3 py-2.5 text-[12.5px] leading-snug text-tone-amber-text">
      <TriangleAlert className="mt-px size-4 shrink-0" strokeWidth={1.9} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function ConfirmRow({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5 text-[13px] leading-snug text-ink-soft">
      <Icon className="mt-0.5 size-4 shrink-0 text-ink-faint" strokeWidth={1.9} />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/* ───────────────────────── helpers ───────────────────────── */

/** Las {{variables}} que aparecen en los textos, en orden y sin repetir. */
function variablesDe(...textos: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const texto of textos) {
    if (!texto) continue;
    const re = /\{\{(\w+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) !== null) {
      if (!out.includes(m[1])) out.push(m[1]);
    }
  }
  return out;
}

/** "312 personas" / "1 persona" — se repite en el toast y en la confirmación. */
function personas(n: number): string {
  return `${fmtNumber(n)} ${n === 1 ? "persona" : "personas"}`;
}

function fmtEta(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

/** "11 ago a las 09:00" — el valor crudo del input datetime-local, en criollo. */
function fmtCuando(valor: string): string {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return valor;
  return `${fmtDate(d)} a las ${fmtTime(d)}`;
}

/**
 * Un ISO como lo quiere un `datetime-local`: "YYYY-MM-DDTHH:mm" en hora local.
 * Sin esto, retomar un borrador programado perdía la hora que ya había elegido.
 */
function paraInputLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}
