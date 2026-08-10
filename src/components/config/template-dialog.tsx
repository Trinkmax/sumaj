"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Ban,
  CircleDashed,
  CircleHelp,
  CirclePause,
  CircleX,
  Clock3,
  ExternalLink,
  Plus,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ChoiceGrid, Tooltip } from "@/components/ui/misc";
import { WaPreview } from "@/components/difusiones/wa-preview";
import { saveTemplate, submitTemplateToMeta } from "@/lib/actions/templates";
import { STAGES, fillTemplate, templateEstaCongelada } from "@/lib/domain";
import { BROADCAST_VAR_KEYS } from "@/lib/broadcasts/audience";
import type { BroadcastIntent, LeadStage, Tables, TemplateButton } from "@/lib/types";
import { cn } from "@/lib/utils";

type Template = Tables<"wa_templates">;

/* ───────────────────────────── estado en Meta ─────────────────────────────
   El tilde manual murió: lo que vale es lo que dice Meta. Cada estado tiene su
   copy porque "pendiente" y "rechazada" piden cosas distintas del usuario. */

export type MetaStatusMeta = {
  label: string;
  /** qué significa y qué hacer — se muestra debajo del chip */
  hint: string;
  chip: string;
  icon: LucideIcon;
};

export const META_STATUS: Record<string, MetaStatusMeta> = {
  local: {
    label: "Sin mandar",
    hint: "Todavía no viajó a Meta. Hasta que no la apruebe, no se puede usar en una difusión.",
    chip: "border-tone-stone-line bg-tone-stone-soft text-tone-stone-text",
    icon: CircleDashed,
  },
  PENDING: {
    label: "En revisión",
    hint: "Meta suele tardar unos minutos. Tocá Sincronizar para ver si ya se resolvió.",
    chip: "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
    icon: Clock3,
  },
  APPROVED: {
    label: "Aprobada",
    hint: "Lista para difundir.",
    chip: "border-tone-emerald-line bg-tone-emerald-soft text-tone-emerald-text",
    icon: BadgeCheck,
  },
  REJECTED: {
    label: "Rechazada",
    hint: "Corregí lo que marca Meta y volvé a mandarla a aprobar.",
    chip: "border-tone-red-line bg-tone-red-soft text-tone-red-text",
    icon: CircleX,
  },
  PAUSED: {
    label: "Pausada",
    hint: "Meta la pausó por baja calidad: mucha gente la bloqueó o la reportó. Vuelve sola si mejora.",
    chip: "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
    icon: CirclePause,
  },
  DISABLED: {
    label: "Deshabilitada",
    hint: "Meta la dio de baja para siempre. Armá una nueva con otro texto.",
    chip: "border-tone-red-line bg-tone-red-soft text-tone-red-text",
    icon: Ban,
  },
  PENDING_DELETION: {
    label: "Borrándose",
    hint: "Se pidió su baja en Meta. En unas horas desaparece.",
    chip: "border-tone-stone-line bg-tone-stone-soft text-tone-stone-text",
    icon: Trash2,
  },
};

export function metaStatusMeta(status: string): MetaStatusMeta {
  return META_STATUS[status] ?? META_STATUS.local;
}

/* ───────────────────────────── variables ─────────────────────────────
   Una plantilla se usa para dos cosas y no completan lo mismo: una DIFUSIÓN
   solo sabe llenar `BROADCAST_VAR_KEYS`, mientras que un SEGUIMIENTO automático
   sale desde un lead y ahí sí hay fecha de viaje.

   Por eso las de difusión van primero y `{{fecha}}` queda marcada: ofrecerla
   como una más hacía que el dueño armara la plantilla con ella, esperara la
   aprobación de Meta, y recién en el composer se enterara —con la plantilla ya
   congelada e ineditable— de que esa difusión no se puede mandar. */

const VARIABLES: { key: string; hint: string; soloSeguimientos?: boolean }[] = [
  { key: "nombre", hint: "nombre del cliente" },
  { key: "destino", hint: "destino del viaje" },
  { key: "agencia", hint: "el nombre de tu agencia" },
  { key: "vendedor", hint: "quien atiende" },
  { key: "fecha", hint: "fecha del viaje — solo en seguimientos, no en difusiones", soloSeguimientos: true },
];

const SAMPLE_VARS = {
  nombre: "Caro",
  vendedor: "Vale",
  destino: "Cancún",
  agencia: "la agencia",
  fecha: "12 de octubre",
};

/** Las {{variables}} de un texto, en orden y sin repetir. */
function variablesDe(texto: string): string[] {
  const out: string[] = [];
  for (const m of texto.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/* ───────────────────────────── botones ─────────────────────────────
   Tres respuestas rápidas es el techo a propósito: en un celular, cuatro
   botones ya no entran de un vistazo y la gente no toca ninguno. */

const MAX_QUICK_REPLIES = 3;
const BUTTON_MAX = 25;

/** Arrancan con lo que mejor funciona, pero el usuario los cambia. */
const SUGGESTED: { text: string; intent: BroadcastIntent }[] = [
  { text: "Quiero info", intent: "interesado" },
  { text: "Solo estoy mirando", intent: "tal_vez" },
  { text: "No me interesa", intent: "baja" },
];

const INTENTS: { value: BroadcastIntent; label: string; icon: LucideIcon; hint: string }[] = [
  { value: "interesado", label: "Interesado", icon: ThumbsUp, hint: "lead caliente" },
  { value: "tal_vez", label: "Tal vez", icon: CircleHelp, hint: "para más adelante" },
  { value: "baja", label: "Baja", icon: ThumbsDown, hint: "no le escribimos más" },
];

/** Los quick reply van SIEMPRE antes que los de link o Meta rechaza la plantilla. */
function orderButtons(quick: TemplateButton[], url: TemplateButton | null): TemplateButton[] {
  return url ? [...quick, url] : [...quick];
}

/** `wa_templates.buttons` es jsonb: nunca confiar en su forma al leerlo. */
export function parseTemplateButtons(value: unknown): TemplateButton[] {
  if (!Array.isArray(value)) return [];
  const out: TemplateButton[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    const type = b.type === "url" ? "url" : "quick_reply";
    const text = typeof b.text === "string" ? b.text : "";
    if (!text) continue;
    out.push({
      type,
      text,
      url: type === "url" && typeof b.url === "string" ? b.url : null,
      intent:
        type === "quick_reply" && (b.intent === "interesado" || b.intent === "tal_vez" || b.intent === "baja")
          ? b.intent
          : null,
    });
  }
  return out;
}

/* ───────────────────────────── el diálogo ───────────────────────────── */

export function TemplateDialog({
  open,
  onOpenChange,
  template,
  onSaved,
  emphasis = "guardar",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  template: Template | null;
  onSaved?: (t: Template) => void;
  /**
   * Cuál es LA acción de este diálogo.
   *
   * En Configuración una plantilla se puede guardar y mandarse más tarde. Pero
   * abierto desde el composer, guardar sin mandar no acerca a nada: la pantalla
   * queda idéntica ("no hay ninguna plantilla aprobada") y no hay una sola
   * pista de que faltaba un paso. Ahí el primario es "Mandar a aprobar".
   */
  emphasis?: "guardar" | "meta";
}) {
  const [name, setName] = React.useState(template?.name ?? "");
  const [metaName, setMetaName] = React.useState(template?.meta_name ?? "");
  const [metaNameTouched, setMetaNameTouched] = React.useState(Boolean(template));
  const [stage, setStage] = React.useState<string>(template?.stage ?? "");
  const [category, setCategory] = React.useState<"marketing" | "utility">(
    template?.category === "utility" ? "utility" : "marketing",
  );
  const [header, setHeader] = React.useState(template?.header_text ?? "");
  const [body, setBody] = React.useState(template?.body ?? "");
  const [footer, setFooter] = React.useState(template?.footer_text ?? "");
  const [quick, setQuick] = React.useState<TemplateButton[]>(() =>
    parseTemplateButtons(template?.buttons).filter((b) => b.type === "quick_reply"),
  );
  const [urlButton, setUrlButton] = React.useState<TemplateButton | null>(
    () => parseTemplateButtons(template?.buttons).find((b) => b.type === "url") ?? null,
  );
  const [saving, setSaving] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  const status = template?.meta_status ?? "local";
  const meta = metaStatusMeta(status);
  const StatusIcon = meta.icon;
  /* Una aprobada (o una que Meta está revisando) no se edita: allá es inmutable
     y editarla de este lado dejaría a la base mintiendo — y al despachador
     mandando un texto con otra cantidad de variables que la aprobada.
     Una RECHAZADA sí, y es lo que el propio chip le pide al admin: mandarla a
     aprobar la borra en Meta y la vuelve a crear con el texto corregido. Sin
     esto, el único camino era crear otra plantilla con otro nombre técnico. */
  const locked = Boolean(template) && templateEstaCongelada(status);
  const busy = saving || sending;

  const buttons = orderButtons(quick, urlButton);

  function handleName(value: string) {
    setName(value);
    if (!metaNameTouched) setMetaName(toMetaNameDraft(value));
  }

  function insertVariable(key: string) {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  /** Devuelve la fila guardada, o null si algo falló (el toast ya salió). */
  async function persist(): Promise<Template | null> {
    if (urlButton && !urlButton.url?.trim()) {
      toast.error("Al botón con link le falta la dirección web.");
      return null;
    }
    if (buttons.some((b) => !b.text.trim())) {
      toast.error("Hay un botón sin texto. Escribilo o borralo.");
      return null;
    }
    const res = await saveTemplate({
      id: template?.id,
      name: name.trim(),
      meta_name: metaName.trim(),
      stage: (stage || null) as LeadStage | null,
      category,
      body: body.trim(),
      header_text: header.trim() || null,
      footer_text: footer.trim() || null,
      buttons,
    });
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    return res.data;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const saved = await persist();
    setSaving(false);
    if (!saved) return;
    toast.success(template ? "Plantilla guardada." : "Plantilla creada.");
    onSaved?.(saved);
    onOpenChange(false);
  }

  async function sendToMeta() {
    setSending(true);
    const saved = await persist();
    if (!saved) {
      setSending(false);
      return;
    }
    const res = await submitTemplateToMeta({ id: saved.id });
    setSending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("La mandamos a Meta. Suele tardar unos minutos en resolverse.");
    onSaved?.({ ...saved, meta_status: res.data.status });
    onOpenChange(false);
  }

  const preview = fillTemplate(body, SAMPLE_VARS);
  const canSendToMeta = !locked && body.trim().length > 0 && name.trim().length > 0;
  const conBotones: readonly string[] = BROADCAST_VAR_KEYS;
  const sinLlenarEnDifusion = variablesDe(body).filter((v) => !conBotones.includes(v));
  const metaEsPrimario = emphasis === "meta" && canSendToMeta;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        title={template ? "Editar plantilla" : "Nueva plantilla"}
        description="El texto que sale del número madre. Los botones son los que traen leads."
        size="lg"
      >
        <form onSubmit={submit} className="space-y-4">
          {template && (
            <div className="rounded-xl border border-line bg-sand-soft/50 px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
                    meta.chip,
                  )}
                >
                  <StatusIcon className="size-3" strokeWidth={2} />
                  {meta.label}
                </span>
                <span className="text-xs text-ink-faint">{meta.hint}</span>
              </div>
              {template.rejected_reason && (
                <p className="mt-2 text-xs text-tone-red-text">
                  Meta dijo: {template.rejected_reason}
                </p>
              )}
              {locked && (
                <p className="mt-2 text-xs text-ink-faint">
                  El mensaje y los botones quedaron congelados: en Meta una plantilla no se edita.
                  Si querés cambiarlos, creá una nueva.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="tpl-name">Nombre *</Label>
              <Input
                id="tpl-name"
                required
                value={name}
                onChange={(e) => handleName(e.target.value)}
                placeholder="Ej: Promo Brasil verano"
                maxLength={80}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="tpl-stage">Etapa</Label>
              <Select id="tpl-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
                <option value="">Genérica (cualquier etapa)</option>
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label>Para qué es</Label>
            <ChoiceGrid<"marketing" | "utility">
              columns={2}
              value={category}
              onChange={(v) => !locked && setCategory(v)}
              options={[
                { value: "marketing", label: "Promoción", icon: Send, hint: "difusiones" },
                { value: "utility", label: "Aviso", icon: BadgeCheck, hint: "algo que pidió" },
              ]}
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              Meta cobra distinto y es más exigente con las promociones. Un aviso es algo que la
              persona pidió (una reserva, un vencimiento).
            </p>
          </div>

          <div>
            <Label htmlFor="tpl-meta">Nombre técnico en Meta *</Label>
            <Input
              id="tpl-meta"
              required
              disabled={locked}
              value={metaName}
              onChange={(e) => {
                setMetaNameTouched(true);
                setMetaName(toMetaNameDraft(e.target.value));
              }}
              placeholder="promo_brasil_verano"
              maxLength={60}
              className="font-mono text-[13px]"
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              Solo minúsculas, números y guión bajo. Es el nombre con el que la busca la Cloud API.
            </p>
          </div>

          <div>
            <Label htmlFor="tpl-header">Título (opcional)</Label>
            <Input
              id="tpl-header"
              value={header}
              disabled={locked}
              onChange={(e) => setHeader(e.target.value)}
              placeholder="Ej: Brasil en enero"
              maxLength={60}
            />
          </div>

          <div>
            <Label htmlFor="tpl-body">Mensaje *</Label>
            <Textarea
              id="tpl-body"
              required
              ref={bodyRef}
              disabled={locked}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={"Hola {{nombre}}! Soy {{vendedor}} de la agencia…"}
              maxLength={1024}
              className="min-h-[120px]"
            />
            {!locked && (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-ink-faint">Variables:</span>
                  {VARIABLES.map((v) => (
                    <Tooltip key={v.key} content={v.hint}>
                      <button
                        type="button"
                        onClick={() => insertVariable(v.key)}
                        className={cn(
                          "min-h-8 rounded-full border px-2.5 font-mono text-[11px] font-medium transition-all active:scale-95 tap-highlight-none",
                          v.soloSeguimientos
                            ? "border-line bg-sand-soft text-ink-soft hover:border-line-strong"
                            : "border-brand-tint-line bg-brand-tint text-brand-text hover:bg-brand-tint-strong",
                        )}
                      >
                        {`{{${v.key}}}`}
                      </button>
                    </Tooltip>
                  ))}
                </div>
                {sinLlenarEnDifusion.length > 0 && (
                  <p className="mt-2 flex items-start gap-2 rounded-xl border border-tone-amber-line bg-tone-amber-soft px-3 py-2 text-xs leading-snug text-tone-amber-text">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.9} />
                    <span>
                      {sinLlenarEnDifusion.map((v) => `{{${v}}}`).join(", ")} no se puede completar
                      en una difusión: sirve para los seguimientos automáticos. Si esta plantilla es
                      para difundir, sacala antes de mandarla a aprobar.
                    </span>
                  </p>
                )}
              </>
            )}
          </div>

          <div>
            <Label htmlFor="tpl-footer">Pie (opcional)</Label>
            <Input
              id="tpl-footer"
              value={footer}
              disabled={locked}
              onChange={(e) => setFooter(e.target.value)}
              placeholder="Ej: Respondé BAJA para no recibir más"
              maxLength={60}
            />
          </div>

          <ButtonsBuilder
            quick={quick}
            urlButton={urlButton}
            locked={locked}
            onQuickChange={setQuick}
            onUrlChange={setUrlButton}
          />

          {body.trim() && (
            <div className="animate-fade-in">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Así lo recibe el cliente
              </p>
              <WaPreview
                header={header.trim() || null}
                body={preview}
                footer={footer.trim() || null}
                buttons={buttons}
              />
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            {metaEsPrimario ? (
              <>
                <Button
                  type="submit"
                  variant="secondary"
                  loading={saving}
                  disabled={sending}
                >
                  Guardar borrador
                </Button>
                <Button type="button" loading={sending} disabled={saving} onClick={sendToMeta}>
                  <Send />
                  Mandar a aprobar
                </Button>
              </>
            ) : (
              <>
                {canSendToMeta && (
                  <Button
                    type="button"
                    variant="brand"
                    loading={sending}
                    disabled={saving}
                    onClick={sendToMeta}
                  >
                    <Send />
                    Mandar a aprobar
                  </Button>
                )}
                <Button type="submit" loading={saving} disabled={sending}>
                  {template ? "Guardar" : "Crear plantilla"}
                </Button>
              </>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Nombre técnico tentativo mientras se escribe el nombre humano. */
function toMetaNameDraft(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/* ───────────────────────── constructor de botones ───────────────────────── */

function ButtonsBuilder({
  quick,
  urlButton,
  locked,
  onQuickChange,
  onUrlChange,
}: {
  quick: TemplateButton[];
  urlButton: TemplateButton | null;
  locked: boolean;
  onQuickChange: (b: TemplateButton[]) => void;
  onUrlChange: (b: TemplateButton | null) => void;
}) {
  function addQuick() {
    const usados = new Set(quick.map((b) => b.text.toLowerCase()));
    const sugerido =
      SUGGESTED.find((s) => !usados.has(s.text.toLowerCase())) ?? SUGGESTED[SUGGESTED.length - 1];
    onQuickChange([...quick, { type: "quick_reply", text: sugerido.text, intent: sugerido.intent }]);
  }

  function patch(index: number, next: Partial<TemplateButton>) {
    onQuickChange(quick.map((b, i) => (i === index ? { ...b, ...next } : b)));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= quick.length) return;
    const next = [...quick];
    [next[index], next[target]] = [next[target], next[index]];
    onQuickChange(next);
  }

  return (
    <div className="rounded-xl border border-line p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink">Botones de respuesta</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            Un toque abre la conversación y crea el lead con su interés ya puesto. Sin botones, la
            difusión funciona igual, pero hay que leer cada respuesta a mano.
          </p>
        </div>
        {!locked && quick.length < MAX_QUICK_REPLIES && (
          <Button type="button" size="sm" variant="secondary" onClick={addQuick} className="shrink-0">
            <Plus />
            Agregar
          </Button>
        )}
      </div>

      {quick.length > 0 && (
        <div className="mt-3 space-y-2.5">
          {quick.map((b, i) => (
            <div key={i} className="rounded-xl border border-line bg-sand-soft/40 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    value={b.text}
                    disabled={locked}
                    onChange={(e) => patch(i, { text: e.target.value.slice(0, BUTTON_MAX) })}
                    placeholder="Quiero info"
                    maxLength={BUTTON_MAX}
                    aria-label={`Texto del botón ${i + 1}`}
                    className="bg-paper"
                  />
                  <p
                    className={cn(
                      "mt-1 text-right text-[11px] tabular-nums",
                      b.text.length >= BUTTON_MAX ? "text-tone-amber-text" : "text-ink-faint",
                    )}
                  >
                    {b.text.length}/{BUTTON_MAX}
                  </p>
                </div>
                {!locked && (
                  /* 44px y separados: con tres targets de 32 pegados, "bajar el
                     botón 2" y "borrar el botón 2" quedaban a un pulgar de
                     distancia y el borrado no tiene deshacer. */
                  <div className="flex shrink-0 items-center gap-1">
                    <Tooltip content="Subir">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-11"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        aria-label={`Subir el botón ${i + 1}`}
                      >
                        <ArrowUp />
                      </Button>
                    </Tooltip>
                    <Tooltip content="Bajar">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-11"
                        disabled={i === quick.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label={`Bajar el botón ${i + 1}`}
                      >
                        <ArrowDown />
                      </Button>
                    </Tooltip>
                    <Tooltip content="Borrar">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => onQuickChange(quick.filter((_, j) => j !== i))}
                        aria-label={`Borrar el botón ${i + 1}`}
                        className="size-11 text-tone-red-text hover:bg-tone-red-soft hover:text-tone-red-text"
                      >
                        <Trash2 />
                      </Button>
                    </Tooltip>
                  </div>
                )}
              </div>

              <ChoiceGrid<BroadcastIntent>
                className="mt-2"
                columns={3}
                size="sm"
                value={b.intent ?? null}
                onChange={(v) => !locked && patch(i, { intent: v })}
                options={INTENTS.map((o) => ({
                  value: o.value,
                  label: o.label,
                  icon: o.icon,
                  hint: o.hint,
                }))}
              />
            </div>
          ))}
        </div>
      )}

      {/* Meta exige que los quick reply vayan antes que el de link: el orden lo
          arma el componente, no el usuario, así no hay forma de equivocarse. */}
      <div className="mt-3 border-t border-line pt-3">
        {urlButton ? (
          <div className="rounded-xl border border-line bg-sand-soft/40 p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <Input
                  value={urlButton.text}
                  disabled={locked}
                  onChange={(e) =>
                    onUrlChange({ ...urlButton, text: e.target.value.slice(0, BUTTON_MAX) })
                  }
                  placeholder="Ver la promo"
                  maxLength={BUTTON_MAX}
                  aria-label="Texto del botón con link"
                  className="bg-paper"
                />
                <Input
                  type="url"
                  value={urlButton.url ?? ""}
                  disabled={locked}
                  onChange={(e) => onUrlChange({ ...urlButton, url: e.target.value })}
                  placeholder="https://…"
                  aria-label="Dirección del botón con link"
                  className="bg-paper font-mono text-[13px]"
                />
              </div>
              {!locked && (
                <Tooltip content="Borrar">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => onUrlChange(null)}
                    aria-label="Borrar el botón con link"
                    className="size-11 shrink-0 text-tone-red-text hover:bg-tone-red-soft hover:text-tone-red-text"
                  >
                    <Trash2 />
                  </Button>
                </Tooltip>
              )}
            </div>
            <p className="mt-2 text-xs text-ink-faint">
              El que toca un link se va de WhatsApp: no abre la conversación ni deja un lead.
            </p>
          </div>
        ) : (
          !locked && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onUrlChange({ type: "url", text: "Ver más", url: "" })}
            >
              <ExternalLink />
              Agregar botón con link
            </Button>
          )
        )}
      </div>

      {locked && quick.length === 0 && !urlButton && (
        <p className="mt-3 text-xs text-ink-faint">Esta plantilla salió sin botones.</p>
      )}
    </div>
  );
}
