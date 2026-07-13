"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { STAGES, STAGE_BY_KEY } from "@/lib/domain";
import type { LeadStage } from "@/lib/types";
import { updateLeadStage, reorderLead } from "@/lib/actions/leads";
import { LeadCard } from "./lead-card";
import { WinLeadDialog, LoseLeadDialog } from "./win-lose-dialogs";
import type { BoardLead } from "./types";

type ColumnsMap = Record<LeadStage, BoardLead[]>;

const STAGE_KEYS = STAGES.map((s) => s.key);

function buildColumns(leads: BoardLead[]): ColumnsMap {
  const map = Object.fromEntries(
    STAGE_KEYS.map((k) => [k, [] as BoardLead[]]),
  ) as ColumnsMap;
  for (const l of leads) (map[l.stage] ?? map.nuevo).push(l);
  for (const k of STAGE_KEYS) {
    map[k].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  }
  return map;
}

/** Fractional index: promedio entre vecinos; extremos ±1; columna vacía 0. */
function computePosition(items: BoardLead[], index: number): number {
  const prev = items[index - 1];
  const next = items[index + 1];
  if (prev && next) return (prev.position + next.position) / 2;
  if (prev) return prev.position + 1;
  if (next) return next.position - 1;
  return 0;
}

export function KanbanBoard({
  leads,
  onPatch,
  onOpenLead,
}: {
  leads: BoardLead[];
  /** actualiza el estado del lead en el padre (optimista) */
  onPatch: (id: string, patch: Partial<BoardLead>) => void;
  /** click en la tarjeta → abre el drawer operativo del lead */
  onOpenLead: (lead: BoardLead) => void;
}) {
  const [columns, setColumns] = React.useState<ColumnsMap>(() => buildColumns(leads));
  const [activeLead, setActiveLead] = React.useState<BoardLead | null>(null);
  const [overStage, setOverStage] = React.useState<LeadStage | null>(null);

  const [pendingWin, setPendingWin] = React.useState<BoardLead | null>(null);
  const [pendingLose, setPendingLose] = React.useState<{ lead: BoardLead; position: number } | null>(null);

  const justDraggedRef = React.useRef(false);
  const snapshotRef = React.useRef<ColumnsMap | null>(null);
  const leadsRef = React.useRef(leads);

  React.useEffect(() => {
    leadsRef.current = leads;
  }, [leads]);

  // resync desde el padre (búsqueda, filtro, revalidación, realtime),
  // salvo durante un drag activo — ajuste de estado durante el render
  const [prevLeads, setPrevLeads] = React.useState(leads);
  if (prevLeads !== leads) {
    setPrevLeads(leads);
    if (activeLead == null) setColumns(buildColumns(leads));
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  function findContainer(id: string): LeadStage | null {
    if ((STAGE_KEYS as string[]).includes(id)) return id as LeadStage;
    for (const k of STAGE_KEYS) if (columns[k].some((l) => l.id === id)) return k;
    return null;
  }

  function findStageInSnapshot(id: string): LeadStage | null {
    const snap = snapshotRef.current;
    if (!snap) return null;
    for (const k of STAGE_KEYS) if (snap[k].some((l) => l.id === id)) return k;
    return null;
  }

  function revertToProps() {
    setColumns(buildColumns(leadsRef.current));
  }

  function handleDragStart(e: DragStartEvent) {
    snapshotRef.current = columns;
    const stage = findContainer(String(e.active.id));
    const lead = stage ? columns[stage].find((l) => l.id === e.active.id) ?? null : null;
    setActiveLead(lead);
  }

  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) {
      setOverStage(null);
      return;
    }
    const from = findContainer(String(active.id));
    const to = findContainer(String(over.id));
    setOverStage(to);
    if (!from || !to || from === to) return;

    setColumns((prev) => {
      const fromItems = [...prev[from]];
      const toItems = [...prev[to]];
      const idx = fromItems.findIndex((l) => l.id === active.id);
      if (idx === -1) return prev;
      const [moved] = fromItems.splice(idx, 1);
      let insertIdx = toItems.findIndex((l) => l.id === over.id);
      if (insertIdx === -1) insertIdx = toItems.length;
      toItems.splice(insertIdx, 0, moved);
      return { ...prev, [from]: fromItems, [to]: toItems };
    });
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    justDraggedRef.current = true;
    setTimeout(() => (justDraggedRef.current = false), 150);
    setActiveLead(null);
    setOverStage(null);

    const activeId = String(active.id);
    const originStage = findStageInSnapshot(activeId);
    if (!originStage) return;

    if (!over) {
      if (snapshotRef.current) setColumns(snapshotRef.current);
      return;
    }

    const targetStage = findContainer(String(over.id)) ?? findContainer(activeId);
    if (!targetStage) {
      if (snapshotRef.current) setColumns(snapshotRef.current);
      return;
    }

    // índice final dentro de la columna destino
    const items = [...columns[targetStage]];
    const fromIdx = items.findIndex((l) => l.id === activeId);
    if (fromIdx === -1) return;
    let toIdx = fromIdx;
    if (String(over.id) !== activeId) {
      const overIdx = items.findIndex((l) => l.id === String(over.id));
      if (overIdx !== -1) toIdx = overIdx;
    }
    const finalItems = arrayMove(items, fromIdx, toIdx);
    setColumns((prev) => ({ ...prev, [targetStage]: finalItems }));

    const finalIdx = finalItems.findIndex((l) => l.id === activeId);
    const lead = finalItems[finalIdx];
    const newPos = computePosition(finalItems, finalIdx);

    // mismo lugar → nada
    const snapIdx = snapshotRef.current?.[originStage].findIndex((l) => l.id === activeId) ?? -1;
    if (targetStage === originStage && finalIdx === snapIdx) return;

    // soltó en ganado → confirmación (no convertir directo)
    if (targetStage === "ganado" && originStage !== "ganado") {
      setPendingWin(lead);
      return;
    }
    // soltó en perdido → pedir motivo
    if (targetStage === "perdido" && originStage !== "perdido") {
      setPendingLose({ lead, position: newPos });
      return;
    }

    const prevPosition = lead.position;
    if (targetStage === originStage) {
      onPatch(lead.id, { position: newPos });
      reorderLead({ leadId: lead.id, position: newPos }).then((res) => {
        if (!res.ok) {
          onPatch(lead.id, { position: prevPosition });
          toast.error(res.error);
        }
      });
    } else {
      onPatch(lead.id, { stage: targetStage, position: newPos });
      updateLeadStage({ leadId: lead.id, stage: targetStage, position: newPos }).then((res) => {
        if (!res.ok) {
          onPatch(lead.id, { stage: originStage, position: prevPosition });
          toast.error(res.error);
        }
      });
    }
  }

  function handleDragCancel() {
    setActiveLead(null);
    setOverStage(null);
    if (snapshotRef.current) setColumns(snapshotRef.current);
  }

  function openLead(lead: BoardLead) {
    // el click se distingue del drag: los sensores tienen activationConstraint
    // y además justDraggedRef bloquea el click fantasma post-drop
    if (justDraggedRef.current) return;
    onOpenLead(lead);
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          className={cn(
            "flex gap-3 overflow-x-auto px-4 pb-2 md:px-6",
            "snap-x snap-mandatory scroll-px-4 md:snap-none",
            "h-[max(440px,calc(100dvh-350px))] md:h-[max(460px,calc(100dvh-250px))]",
          )}
        >
          {STAGES.map((meta) => (
            <KanbanColumn
              key={meta.key}
              stage={meta.key}
              leads={columns[meta.key]}
              isOver={overStage === meta.key && activeLead != null}
              dragging={activeLead != null}
              onCardClick={openLead}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.16,1,0.3,1)" }}>
          {activeLead && <LeadCard lead={activeLead} overlay />}
        </DragOverlay>
      </DndContext>

      <WinLeadDialog
        open={pendingWin != null}
        onOpenChange={(o) => {
          if (!o) setPendingWin(null);
        }}
        lead={pendingWin ? { id: pendingWin.id, name: pendingWin.contact.full_name } : null}
        onWon={(fileId) => {
          if (pendingWin) onPatch(pendingWin.id, { stage: "ganado", won_file_id: fileId });
        }}
        onCancel={revertToProps}
      />

      <LoseLeadDialog
        open={pendingLose != null}
        onOpenChange={(o) => {
          if (!o) setPendingLose(null);
        }}
        lead={
          pendingLose
            ? { id: pendingLose.lead.id, name: pendingLose.lead.contact.full_name }
            : null
        }
        position={pendingLose?.position}
        onLost={() => {
          if (pendingLose)
            onPatch(pendingLose.lead.id, { stage: "perdido", position: pendingLose.position });
        }}
        onCancel={revertToProps}
      />
    </>
  );
}

/* ───────────────────────────── columna ───────────────────────────── */

function KanbanColumn({
  stage,
  leads,
  isOver,
  dragging,
  onCardClick,
}: {
  stage: LeadStage;
  leads: BoardLead[];
  isOver: boolean;
  dragging: boolean;
  onCardClick: (lead: BoardLead) => void;
}) {
  const meta = STAGE_BY_KEY[stage];
  const muted = !meta.active;
  const { setNodeRef } = useDroppable({ id: stage });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex h-full w-[85vw] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-line bg-sand-soft/50 transition-all md:w-[270px]",
        muted && "opacity-75",
        isOver && "border-transparent bg-brand-50/40 opacity-100 ring-2 ring-brand-300",
      )}
    >
      <div className={cn("h-1.5 shrink-0", meta.headerBar, muted && "opacity-50")} />
      <header className="flex shrink-0 items-center justify-between px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} />
          <h2 className="truncate text-[13px] font-semibold text-ink">{meta.label}</h2>
        </div>
        <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-soft shadow-sm">
          {leads.length}
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <SortableLeadCard
              key={lead.id}
              lead={lead}
              muted={muted}
              onClick={() => onCardClick(lead)}
            />
          ))}
        </SortableContext>
        {leads.length === 0 && (
          <div
            className={cn(
              "flex h-24 items-center justify-center rounded-xl border border-dashed text-[12px]",
              dragging
                ? "border-brand-300 text-brand-600"
                : "border-line-strong/60 text-ink-faint/70",
            )}
          >
            {dragging ? "Soltá acá" : "Sin leads"}
          </div>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────────── card sortable ───────────────────────────── */

function SortableLeadCard({
  lead,
  muted,
  onClick,
}: {
  lead: BoardLead;
  muted: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    disabled: lead.stage === "ganado", // un lead ganado no vuelve atrás desde el tablero
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("touch-manipulation", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <LeadCard lead={lead} muted={muted} onClick={onClick} />
    </div>
  );
}
