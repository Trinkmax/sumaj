"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageSquareText, Pencil, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch, EmptyState, Tooltip } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/config/confirm-dialog";
import { TemplateDialog, metaStatusMeta } from "@/components/config/template-dialog";
import { parseTemplateButtons } from "@/lib/templates";
import { WaPreview } from "@/components/difusiones/wa-preview";
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
  /* El diálogo arranca su estado en el primer render. Con `key={editing?.id ??
     "new"}`, crear dos plantillas seguidas no lo remontaba (la key seguía en
     "new") y la segunda aparecía con el texto, el nombre técnico y los botones
     de la primera. La secuencia fuerza el remonte en cada apertura. */
  const [dialogSeq, setDialogSeq] = React.useState(0);

  function abrirNueva() {
    setDialogSeq((n) => n + 1);
    setCreateOpen(true);
  }

  function abrirEdicion(t: Template) {
    setDialogSeq((n) => n + 1);
    setEditing(t);
  }

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
          <Button onClick={abrirNueva}>
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
            <Button onClick={abrirNueva}>
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
              onEdit={() => abrirEdicion(t)}
              onDelete={() => setToDelete(t)}
            />
          ))}
        </div>
      )}

      <TemplateDialog
        key={`tpl-${editing?.id ?? "new"}-${dialogSeq}`}
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
        {/* La misma burbuja que ve el composer y la pantalla de resultados: si
            acá se dibujara distinto, tres pantallas prometerían tres cosas
            sobre el mismo mensaje. Las {{variables}} sin valor quedan
            resaltadas, que es lo que hace falta en una lista de plantillas. */}
        <WaPreview
          header={template.header_text}
          body={template.body}
          footer={template.footer_text}
          buttons={buttons}
        />
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
            {/* Antes decía "Aprobada a mano" y era el generador del estado
                imposible: prendido, la plantilla quedaba con `is_approved` en
                true sin existir en Meta, y el chat —que filtraba por esa
                columna— la ofrecía para reabrir una conversación. Meta la
                contestaba con "template name does not exist".
                El tilde SÍ tiene un uso real y es este: por el número de la
                sucursal la plantilla es texto libre y no hay nada que aprobar.
                Ahora el nombre dice eso y nada más. */}
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-faint">
              <Tooltip content="Solo sale por el número de la sucursal, donde una plantilla es texto común. Para el número madre hay que mandarla a aprobar.">
                <span className="underline decoration-dotted underline-offset-2">
                  Usar en el seguimiento
                </span>
              </Tooltip>
              <Switch
                checked={approved}
                onCheckedChange={toggleApproved}
                aria-label="Usar esta plantilla en el seguimiento automático por la sucursal"
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
