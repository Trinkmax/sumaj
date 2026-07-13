"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, BadgeCheck, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Switch, EmptyState, Tooltip } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/config/confirm-dialog";
import { deleteTemplate, upsertTemplate } from "@/lib/actions/settings";
import { STAGES, STAGE_BY_KEY, fillTemplate } from "@/lib/domain";
import type { LeadStage, Tables } from "@/lib/types";
import { cn } from "@/lib/utils";

type Template = Tables<"wa_templates">;

const VARIABLES = [
  { key: "nombre", hint: "nombre del cliente" },
  { key: "vendedor", hint: "quien atiende" },
  { key: "destino", hint: "destino del viaje" },
  { key: "fecha", hint: "fecha del viaje" },
];

const SAMPLE_VARS = {
  nombre: "Caro",
  vendedor: "Vale",
  destino: "Cancún",
  fecha: "12 de octubre",
};

/** Renderiza el body resaltando las {{variables}} */
function HighlightedBody({ body }: { body: string }) {
  const parts = body.split(/(\{\{\w+\}\})/g);
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
      {parts.map((p, i) =>
        /^\{\{\w+\}\}$/.test(p) ? (
          <code
            key={i}
            className="mx-px rounded-md bg-brand-50 px-1.5 py-0.5 font-mono text-[12px] font-medium text-brand-700"
          >
            {p}
          </code>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </p>
  );
}

export function TemplatesManager({ templates }: { templates: Template[] }) {
  const [editing, setEditing] = React.useState<Template | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<Template | null>(null);

  const stageOrder = STAGES.map((s) => s.key);
  const sorted = [...templates].sort((a, b) => {
    const ai = a.stage ? stageOrder.indexOf(a.stage) : 99;
    const bi = b.stage ? stageOrder.indexOf(b.stage) : 99;
    return ai - bi || a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          Mensajes listos para enviar desde los chats y el seguimiento automático.
        </p>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <Plus />
          <span className="hidden sm:inline">Nueva plantilla</span>
          <span className="sm:hidden">Nueva</span>
        </Button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          emoji="💬"
          title="Todavía no hay plantillas"
          description="Creá la primera para responder más rápido y activar el seguimiento automático."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Crear plantilla
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 animate-slide-up">
          {sorted.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onEdit={() => setEditing(t)}
              onDelete={() => setToDelete(t)}
            />
          ))}
        </div>
      )}

      <TemplateDialog
        key={editing?.id ?? "new"}
        open={createOpen || editing !== null}
        template={editing}
        onOpenChange={(o) => {
          if (!o) {
            setCreateOpen(false);
            setEditing(null);
          }
        }}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`¿Eliminar "${toDelete?.name}"?`}
        description="Los seguimientos automáticos que la usen van a dejar de enviarla."
        onConfirm={async () => {
          if (!toDelete) return;
          const res = await deleteTemplate({ id: toDelete.id });
          if (!res.ok) {
            toast.error(res.error);
          } else {
            toast.success("Plantilla eliminada.");
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}

function TemplateCard({
  template,
  onEdit,
  onDelete,
}: {
  template: Template;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [approved, setApproved] = React.useState(template.is_approved);
  const stage = template.stage ? STAGE_BY_KEY[template.stage] : null;

  async function toggleApproved(next: boolean) {
    const prev = approved;
    setApproved(next); // optimista
    const res = await upsertTemplate({
      id: template.id,
      name: template.name,
      meta_name: template.meta_name,
      stage: template.stage,
      body: template.body,
      is_approved: next,
    });
    if (!res.ok) {
      setApproved(prev);
      toast.error(res.error);
    }
  }

  return (
    <article className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {stage ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
                  stage.chip,
                )}
              >
                <span className={cn("size-1.5 rounded-full", stage.dot)} />
                {stage.label}
              </span>
            ) : (
              <Badge>Genérica</Badge>
            )}
            {approved ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium leading-4 text-emerald-700">
                <BadgeCheck className="size-3" />
                Aprobada por Meta
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium leading-4 text-amber-700">
                <Clock3 className="size-3" />
                Pendiente
              </span>
            )}
          </div>
          <h3 className="mt-1.5 truncate font-medium text-ink">{template.name}</h3>
        </div>
        <div className="flex shrink-0 items-center">
          <Tooltip content="Editar">
            <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label={`Editar ${template.name}`}>
              <Pencil />
            </Button>
          </Tooltip>
          <Tooltip content="Eliminar">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onDelete}
              aria-label={`Eliminar ${template.name}`}
              className="text-red-500 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="mt-3 flex-1 rounded-xl bg-sand-soft/50 p-3.5">
        <HighlightedBody body={template.body} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <code className="truncate font-mono text-[11px] text-ink-faint">{template.meta_name}</code>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-ink-faint">
          Aprobada
          <Switch checked={approved} onCheckedChange={toggleApproved} aria-label="Aprobada por Meta" />
        </label>
      </div>
    </article>
  );
}

function TemplateDialog({
  open,
  template,
  onOpenChange,
}: {
  open: boolean;
  template: Template | null;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = React.useState(template?.name ?? "");
  const [metaName, setMetaName] = React.useState(template?.meta_name ?? "");
  const [stage, setStage] = React.useState<string>(template?.stage ?? "");
  const [body, setBody] = React.useState(template?.body ?? "");
  const [approved, setApproved] = React.useState(template?.is_approved ?? false);
  const [loading, setLoading] = React.useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  function insertVariable(key: string) {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await upsertTemplate({
      id: template?.id,
      name: name.trim(),
      meta_name: metaName.trim(),
      stage: (stage || null) as LeadStage | null,
      body: body.trim(),
      is_approved: approved,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(template ? "Plantilla guardada." : "Plantilla creada 💬");
    onOpenChange(false);
  }

  const preview = fillTemplate(body, SAMPLE_VARS);

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent
        title={template ? "Editar plantilla" : "Nueva plantilla"}
        description="Usá variables para personalizar cada mensaje."
        size="lg"
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="tpl-name">Nombre *</Label>
              <Input
                id="tpl-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Primer contacto"
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
            <Label htmlFor="tpl-meta">Nombre técnico en Meta *</Label>
            <Input
              id="tpl-meta"
              required
              value={metaName}
              onChange={(e) => setMetaName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
              placeholder="primer_contacto"
              maxLength={80}
              className="font-mono text-[13px]"
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              Tiene que coincidir con el nombre de la plantilla en la Cloud API.
            </p>
          </div>

          <div>
            <Label htmlFor="tpl-body">Mensaje *</Label>
            <Textarea
              id="tpl-body"
              required
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={"Hola {{nombre}}! Soy {{vendedor}} de la agencia…"}
              maxLength={2000}
              className="min-h-[120px]"
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-ink-faint">Variables:</span>
              {VARIABLES.map((v) => (
                <Tooltip key={v.key} content={v.hint}>
                  <button
                    type="button"
                    onClick={() => insertVariable(v.key)}
                    className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 font-mono text-[11px] font-medium text-brand-700 transition-all hover:bg-brand-100 active:scale-95 tap-highlight-none"
                  >
                    {`{{${v.key}}}`}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>

          {body.trim() && (
            <div className="rounded-xl border border-line bg-sand-soft/50 p-3.5">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Así lo recibe el cliente
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{preview}</p>
            </div>
          )}

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-3">
            <span>
              <span className="block text-sm font-medium text-ink">Aprobada por Meta</span>
              <span className="block text-xs text-ink-faint">
                Marcala cuando Meta la apruebe en la Cloud API.
              </span>
            </span>
            <Switch checked={approved} onCheckedChange={setApproved} aria-label="Aprobada por Meta" />
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading}>
              {template ? "Guardar" : "Crear plantilla"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
