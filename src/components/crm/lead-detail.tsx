"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronRight,
  Megaphone,
  MessageCircle,
  ReceiptText,
  Store,
  Trophy,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CHANNELS, QUOTE_STATUSES, STAGES, STAGE_BY_KEY } from "@/lib/domain";
import { fmtDate, fmtMoney, fmtPhone, fmtRelative } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { EmptyState, Tooltip } from "@/components/ui/misc";
import { openLeadChat, reassignLead, updateLeadStage } from "@/lib/actions/leads";
import type { LeadStage } from "@/lib/types";
import { NextActionCard } from "./next-action-card";
import { TripDetailsCard } from "./trip-details-card";
import { ContactTags } from "./contact-tags";
import { LeadTimeline } from "./lead-timeline";
import { WinLeadDialog, LoseLeadDialog } from "./win-lose-dialogs";
import type { DetailLead, LeadActivity, LeadQuote, MemberOption, TagOption } from "./types";

const ACTIVE_STAGES = STAGES.filter((s) => s.active);

const ASSIGN_ADMIN_HINT = "La asignación la maneja un admin";

export function LeadDetail({
  lead,
  branch,
  quotes,
  activities,
  members,
  allTags,
  me,
}: {
  lead: DetailLead;
  /** sucursal dueña del lead (chip de solo lectura) */
  branch?: { id: string; name: string; color: string } | null;
  quotes: LeadQuote[];
  activities: LeadActivity[];
  members: MemberOption[];
  allTags: TagOption[];
  me: { id: string; name: string; isAdmin: boolean };
}) {
  const router = useRouter();

  const [stage, setStage] = React.useState<LeadStage>(lead.stage);
  const [assigned, setAssigned] = React.useState(lead.assigned_to ?? "");
  const [chatLoading, setChatLoading] = React.useState(false);
  const [winOpen, setWinOpen] = React.useState(false);
  const [loseOpen, setLoseOpen] = React.useState(false);

  // resync con el server (ajuste de estado durante el render)
  const [prevStage, setPrevStage] = React.useState(lead.stage);
  if (prevStage !== lead.stage) {
    setPrevStage(lead.stage);
    setStage(lead.stage);
  }
  const [prevAssigned, setPrevAssigned] = React.useState(lead.assigned_to);
  if (prevAssigned !== lead.assigned_to) {
    setPrevAssigned(lead.assigned_to);
    setAssigned(lead.assigned_to ?? "");
  }

  const isClosed = stage === "ganado" || stage === "perdido";

  async function changeStage(next: LeadStage) {
    if (next === stage) return;
    const prev = stage;
    setStage(next); // optimista
    const res = await updateLeadStage({ leadId: lead.id, stage: next });
    if (!res.ok) {
      setStage(prev);
      toast.error(res.error);
      return;
    }
    router.refresh();
  }

  async function reassign(memberId: string) {
    const prev = assigned;
    setAssigned(memberId); // optimista
    const res = await reassignLead({ leadId: lead.id, memberId: memberId || null });
    if (!res.ok) {
      setAssigned(prev);
      toast.error(res.error);
      return;
    }
    router.refresh();
  }

  async function goChat() {
    setChatLoading(true);
    const res = await openLeadChat({ leadId: lead.id });
    // si la action redirige, nunca llegamos acá; si falla, avisamos
    if (res && !res.ok) {
      toast.error(res.error);
      setChatLoading(false);
    }
  }

  const assigneeSelect = (
    <Select
      value={assigned}
      onChange={(e) => reassign(e.target.value)}
      aria-label={
        me.isAdmin ? "Vendedor asignado" : `Vendedor asignado — ${ASSIGN_ADMIN_HINT}`
      }
      disabled={!me.isAdmin}
      className={cn(
        "h-9 text-[13px]",
        // deshabilitado no dispara hover: sin esto el tooltip del wrapper no abre
        !me.isAdmin && "pointer-events-none",
      )}
    >
      <option value="">Sin asignar</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.display_name}
          {m.id === me.id ? " (yo)" : ""}
        </option>
      ))}
    </Select>
  );

  const currentIdx = ACTIVE_STAGES.findIndex((s) => s.key === stage);
  const stageMeta = STAGE_BY_KEY[stage];
  const StageIcon = stageMeta.icon;
  const channel = CHANNELS[lead.origin_channel];
  const ChannelIcon = channel.icon;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 md:px-6 md:pt-6 animate-slide-up">
      <Link
        href="/crm"
        className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-faint transition-colors hover:text-ink tap-highlight-none"
      >
        <ArrowLeft className="size-3.5" />
        Pipeline
      </Link>

      {/* header */}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3.5">
          <Avatar
            name={lead.contact.full_name}
            className="mt-0.5 size-12 text-base md:size-14 md:text-lg"
          />
          <div className="min-w-0">
            <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-ink md:text-[32px]">
              <Link
                href={`/clientes/${lead.contact.id}`}
                className="decoration-line-strong underline-offset-4 transition-colors hover:underline tap-highlight-none"
                title="Ver cliente"
              >
                {lead.contact.full_name}
              </Link>
            </h1>
            <p className="mt-0.5 text-sm text-ink-soft">
              {fmtPhone(lead.contact.phone)} · consulta de {fmtRelative(lead.created_at)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge className={stageMeta.chip}>
                <StageIcon className="size-3" strokeWidth={2} />
                {stageMeta.label}
              </Badge>
              <Badge>
                <ChannelIcon className="size-3" strokeWidth={2} />
                {channel.label}
              </Badge>
              {lead.origin_campaign && (
                <Badge>
                  <Megaphone className="size-3" strokeWidth={2} />
                  {lead.origin_campaign}
                </Badge>
              )}
              {branch && (
                <Badge color={branch.color}>
                  <Store className="size-3" strokeWidth={2} />
                  {branch.name}
                </Badge>
              )}
              <ContactTags
                contactId={lead.contact.id}
                leadId={lead.id}
                initialTags={lead.tags}
                allTags={allTags}
              />
            </div>
          </div>
        </div>

        {/* se ve siempre a quién está asignado; solo el admin lo cambia */}
        <div className="w-full sm:w-48">
          {me.isAdmin ? (
            assigneeSelect
          ) : (
            <Tooltip content={ASSIGN_ADMIN_HINT}>
              <span className="block cursor-not-allowed">{assigneeSelect}</span>
            </Tooltip>
          )}
        </div>
      </div>

      {/* banners de cierre */}
      {stage === "ganado" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-tone-emerald-line bg-tone-emerald-soft p-4 animate-pop">
          <p className="flex items-center gap-2.5 text-sm font-medium text-tone-emerald-text">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-paper/60">
              <Trophy className="size-4" strokeWidth={2} />
            </span>
            Lead ganado
            {lead.wonFile ? ` — se creó el file ${lead.wonFile.code}` : ""}
          </p>
          {lead.wonFile && (
            <Link
              href={`/files/${lead.wonFile.id}`}
              className={buttonVariants({ variant: "success", size: "sm" })}
            >
              Ver file
              <ChevronRight />
            </Link>
          )}
        </div>
      )}
      {stage === "perdido" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-tone-stone-line bg-tone-stone-soft p-4 animate-fade-in">
          <p className="flex items-center gap-2.5 text-sm text-tone-stone-text">
            <XCircle className="size-4 shrink-0" strokeWidth={2} />
            Lead perdido{lead.lost_reason ? ` — ${lead.lost_reason}` : ""}
          </p>
          <Button variant="secondary" size="sm" onClick={() => changeStage("nuevo")}>
            Reabrir lead
          </Button>
        </div>
      )}

      {/* stepper de etapas (clickeable, optimista) */}
      {!isClosed && (
        <div className="mt-4 grid grid-cols-4 gap-1.5">
          {ACTIVE_STAGES.map((s, i) => {
            const done = i < currentIdx;
            const current = i === currentIdx;
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                onClick={() => changeStage(s.key)}
                className={cn(
                  "group rounded-xl px-1 py-2 text-center transition-all tap-highlight-none active:scale-[0.98]",
                  current ? "bg-paper shadow-sm ring-1 ring-line" : "hover:bg-sand-soft/70",
                )}
                aria-current={current ? "step" : undefined}
                title={`Mover a ${s.label}`}
              >
                <span
                  className={cn(
                    "mb-1.5 block h-1 rounded-full transition-colors",
                    done || current ? s.headerBar : "bg-line",
                  )}
                />
                <span
                  className={cn(
                    "flex items-center justify-center gap-1 truncate text-[11px] leading-tight md:text-[12px]",
                    current
                      ? "font-semibold text-ink"
                      : done
                        ? "font-medium text-ink-soft"
                        : "text-ink-faint",
                  )}
                >
                  <Icon
                    className={cn(
                      "hidden size-3.5 shrink-0 sm:block",
                      current ? "text-ink" : done ? "text-ink-soft" : "text-ink-faint/70",
                    )}
                    strokeWidth={2}
                  />
                  <span className="truncate">{s.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* acciones grandes */}
      <div className={cn("mt-4 grid grid-cols-2 gap-2", !isClosed && "md:grid-cols-4")}>
        <Button variant="whatsapp" size="lg" onClick={goChat} loading={chatLoading}>
          <MessageCircle />
          WhatsApp
        </Button>
        <Link
          href={`/presupuestos/nuevo?lead=${lead.id}`}
          className={buttonVariants({ variant: "secondary", size: "lg" })}
        >
          <ReceiptText />
          Presupuestar
        </Link>
        {!isClosed && (
          <>
            <Button variant="success" size="lg" onClick={() => setWinOpen(true)}>
              <Trophy />
              Ganar
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="text-tone-red-text hover:border-tone-red-line hover:bg-tone-red-soft"
              onClick={() => setLoseOpen(true)}
            >
              <X />
              Perder
            </Button>
          </>
        )}
      </div>

      {/* contenido */}
      <div className="mt-4 grid gap-4 pb-4 md:grid-cols-5">
        <div className="space-y-4 md:col-span-3">
          <NextActionCard
            leadId={lead.id}
            nextAction={lead.next_action}
            nextActionAt={lead.next_action_at}
          />
          <TripDetailsCard lead={lead} />

          {/* origen */}
          <section className="card p-4 animate-fade-in">
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Origen</h2>
            <dl className="space-y-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[13px] text-ink-faint">Canal</dt>
                <dd className="flex items-center gap-1.5 font-medium text-ink">
                  <ChannelIcon className="size-3.5 text-ink-faint" strokeWidth={2} />
                  {channel.label}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[13px] text-ink-faint">Campaña</dt>
                <dd className={lead.origin_campaign ? "font-medium text-ink" : "text-ink-faint/60"}>
                  {lead.origin_campaign ?? "—"}
                </dd>
              </div>
            </dl>
            {lead.initial_message && (
              <blockquote className="mt-3 rounded-xl bg-sand-soft/70 px-3.5 py-2.5 text-[13px] italic leading-snug text-ink-soft">
                “{lead.initial_message}”
              </blockquote>
            )}
          </section>

          {/* presupuestos del lead */}
          <section className="card p-4 animate-fade-in">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-ink">Presupuestos</h2>
              <Link
                href={`/presupuestos/nuevo?lead=${lead.id}`}
                className="text-[13px] font-medium text-brand-text transition-colors hover:opacity-80 tap-highlight-none"
              >
                + Nuevo
              </Link>
            </div>
            {quotes.length === 0 ? (
              <EmptyState
                icon={ReceiptText}
                title="Sin presupuestos todavía"
                description="Armale uno en un minuto desde el cotizador."
                className="py-8"
                action={
                  <Link
                    href={`/presupuestos/nuevo?lead=${lead.id}`}
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                  >
                    Crear presupuesto
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-line/60">
                {quotes.map((q) => {
                  const qMeta = QUOTE_STATUSES[q.status];
                  return (
                    <li key={q.id}>
                      <Link
                        href={`/presupuestos/${q.id}`}
                        className="flex min-h-14 items-center justify-between gap-3 py-2.5 transition-colors hover:bg-sand-soft/50 tap-highlight-none"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">{q.code}</p>
                          <p className="text-[12px] text-ink-faint">{fmtDate(q.created_at)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2.5">
                          <span className="text-sm font-semibold tabular-nums text-ink">
                            {fmtMoney(q.total_price, q.currency)}
                          </span>
                          <Badge className={qMeta.chip}>
                            <qMeta.icon className="size-3" strokeWidth={2} />
                            {qMeta.label}
                          </Badge>
                          <ChevronRight className="size-4 text-ink-faint" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="md:col-span-2">
          <LeadTimeline leadId={lead.id} activities={activities} meName={me.name} />
        </div>
      </div>

      <WinLeadDialog
        open={winOpen}
        onOpenChange={setWinOpen}
        lead={{ id: lead.id, name: lead.contact.full_name }}
        onWon={() => {
          setStage("ganado");
          router.refresh();
        }}
      />
      <LoseLeadDialog
        open={loseOpen}
        onOpenChange={setLoseOpen}
        lead={{ id: lead.id, name: lead.contact.full_name }}
        onLost={() => {
          setStage("perdido");
          router.refresh();
        }}
      />
    </div>
  );
}
