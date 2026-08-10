"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCheck,
  ExternalLink,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Reply,
  Send,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch, EmptyState, Tooltip } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/config/confirm-dialog";
import {
  HighlightedBody,
  TemplateDialog,
  metaStatusMeta,
  parseTemplateButtons,
} from "@/components/config/template-dialog";
import { deleteTemplate, upsertTemplate } from "@/lib/actions/settings";
import { deleteMetaTemplateAction, submitTemplateToMeta, syncTemplatesFromMeta } from "@/lib/actions/templates";
import { STAGES, STAGE_BY_KEY } from "@/lib/domain";
import type { Tables } from "@/lib/types";
import { cn } from "@/lib/utils";

type Template = Tables<"wa_templates">;

export function TemplatesManager({
  templates,
  cloudReady,
}: {
  templates: Template[];
  /** número madre conectado: sin él no hay ni aprobación ni sincronización */
  cloudReady: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<Template | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<Template | null>(null);
  const [syncing, setSyncing] = React.useState(false);

  const stageOrder = STAGES.map((s) => s.key);
  const sorted = [...templates].sort((a, b) => {
    const ai = a.stage ? stageOrder.indexOf(a.stage) : 99;
    const bi = b.stage ? stageOrder.indexOf(b.stage) : 99;
    return ai - bi || a.name.localeCompare(b.name);
  });

  async function sync() {
    setSyncing(true);
    const res = await syncTemplatesFromMeta();
    setSyncing(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const { actualizadas, nuevas } = res.data;
    if (actualizadas === 0 && nuevas === 0) {
      toast.success("Ya estaba todo al día.");
    } else {
      const partes = [
        actualizadas > 0 ? `${actualizadas} actualizada${actualizadas === 1 ? "" : "s"}` : null,
        nuevas > 0 ? `${nuevas} nueva${nuevas === 1 ? "" : "s"}` : null,
      ].filter(Boolean);
      toast.success(`Listo: ${partes.join(" y ")}.`);
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          Los mensajes que salen del número madre. Meta las tiene que aprobar antes de usarlas.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {cloudReady && (
            <Button variant="secondary" onClick={sync} loading={syncing}>
              <RefreshCw />
              <span className="hidden sm:inline">Sincronizar con Meta</span>
              <span className="sm:hidden">Sincronizar</span>
            </Button>
          )}
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            <span className="hidden sm:inline">Nueva plantilla</span>
            <span className="sm:hidden">Nueva</span>
          </Button>
        </div>
      </div>

      {!cloudReady && (
        <div className="rounded-2xl border border-tone-amber-line bg-tone-amber-soft px-4 py-3">
          <p className="text-sm font-medium text-tone-amber-text">
            El número madre todavía no está conectado
          </p>
          <p className="mt-0.5 text-[13px] text-tone-amber-text/90">
            Podés escribir las plantillas igual, pero para mandarlas a aprobar hace falta la
            conexión con Meta.{" "}
            <Link href="/config/whatsapp" className="font-medium underline underline-offset-2">
              Conectar WhatsApp
            </Link>
          </p>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title="Todavía no hay plantillas"
          description="Creá la primera para responder más rápido, activar el seguimiento automático y difundir."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Crear plantilla
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 stagger-children">
          {sorted.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              cloudReady={cloudReady}
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
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`¿Eliminar "${toDelete?.name}"?`}
        description={
          toDelete && toDelete.meta_status !== "local"
            ? "Se borra acá y también en Meta. Los seguimientos que la usen van a dejar de enviarla."
            : "Los seguimientos automáticos que la usen van a dejar de enviarla."
        }
        onConfirm={async () => {
          if (!toDelete) return;
          // Si vive en Meta hay que darla de baja allá también: si solo la
          // borramos acá, el nombre queda tomado y no se puede volver a crear.
          const res =
            toDelete.meta_status === "local"
              ? await deleteTemplate({ id: toDelete.id })
              : await deleteMetaTemplateAction({ id: toDelete.id });
          if (!res.ok) {
            toast.error(res.error);
          } else {
            toast.success("Plantilla eliminada.");
            router.refresh();
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}

function TemplateCard({
  template,
  cloudReady,
  onEdit,
  onDelete,
}: {
  template: Template;
  cloudReady: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const [approved, setApproved] = React.useState(template.is_approved);
  const [sending, setSending] = React.useState(false);
  const stage = template.stage ? STAGE_BY_KEY[template.stage] : null;
  const meta = metaStatusMeta(template.meta_status);
  const StatusIcon = meta.icon;
  const buttons = parseTemplateButtons(template.buttons);
  /* El tilde a mano sobrevive solo para las viejas: en las que viven en Meta,
     `is_approved` la escribe un trigger desde `meta_status` y tocarla mentiría. */
  const isLocal = template.meta_status === "local";

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

  async function sendToMeta() {
    setSending(true);
    const res = await submitTemplateToMeta({ id: template.id });
    setSending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("La mandamos a Meta. Suele tardar unos minutos en resolverse.");
    router.refresh();
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
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
                meta.chip,
              )}
            >
              <StatusIcon className="size-3" strokeWidth={2} />
              {meta.label}
            </span>
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
              className="text-tone-red-text hover:bg-tone-red-soft hover:text-tone-red-text"
            >
              <Trash2 />
            </Button>
          </Tooltip>
        </div>
      </div>

      <p className="mt-1.5 text-xs text-ink-faint">{meta.hint}</p>
      {template.rejected_reason && template.meta_status === "REJECTED" && (
        <p className="mt-1 text-xs text-tone-red-text">Meta dijo: {template.rejected_reason}</p>
      )}

      <div className="mt-3 flex-1">
        <div className="wa-wallpaper overflow-hidden rounded-xl p-3 pl-8">
          <div
            className={cn(
              "relative ml-auto mr-2 w-fit max-w-full overflow-hidden rounded-lg rounded-tr-none bg-wa-bubble-out shadow-sm bubble-tail-out",
              buttons.length > 0 && "min-w-[190px]",
            )}
          >
            <div className="px-2.5 pb-1.5 pt-1.5">
              {template.header_text && (
                <p className="mb-0.5 text-[13.5px] font-semibold leading-snug text-wa-bubble-ink">
                  {template.header_text}
                </p>
              )}
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-wa-bubble-ink">
                <HighlightedBody body={template.body} />
              </p>
              {template.footer_text && (
                <p className="mt-1 text-[11.5px] leading-snug text-wa-bubble-meta">
                  {template.footer_text}
                </p>
              )}
              <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] leading-none text-wa-bubble-meta">
                11:42
                <CheckCheck className="size-3.5 text-wa-tick" strokeWidth={2} />
              </span>
            </div>
            {buttons.length > 0 && (
              <div>
                {buttons.map((b, i) => (
                  <div
                    key={`${b.text}-${i}`}
                    className="flex items-center justify-center gap-1.5 border-t border-wa-bubble-ink/10 px-3 py-2 text-[13px] font-medium text-wa-tick"
                  >
                    {b.type === "url" ? (
                      <ExternalLink className="size-3.5" strokeWidth={2} />
                    ) : (
                      <Reply className="size-3.5" strokeWidth={2} />
                    )}
                    <span className="truncate">{b.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <code className="min-w-0 truncate font-mono text-[11px] text-ink-faint">
          {template.meta_name}
        </code>
        {isLocal ? (
          <div className="flex shrink-0 items-center gap-2">
            {cloudReady && (
              <Button size="sm" variant="secondary" loading={sending} onClick={sendToMeta}>
                <Send />
                Mandar a aprobar
              </Button>
            )}
            {/* El tilde a mano es para las que Meta ya aprobó por fuera del
                sistema: sin él, esas plantillas viejas dejarían de enviarse. */}
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-faint">
              Aprobada a mano
              <Switch
                checked={approved}
                onCheckedChange={toggleApproved}
                aria-label="Marcar como aprobada a mano"
              />
            </label>
          </div>
        ) : (
          template.meta_status === "REJECTED" &&
          cloudReady && (
            <Button size="sm" variant="secondary" loading={sending} onClick={sendToMeta}>
              <Send />
              Volver a mandar
            </Button>
          )
        )}
      </div>
    </article>
  );
}
