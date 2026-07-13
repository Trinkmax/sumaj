"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AtSign,
  BadgeCheck,
  FolderOpen,
  KanbanSquare,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  ReceiptText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/misc";
import { QuoteDialog } from "@/components/quotes/quote-dialog";
import { fmtPhone } from "@/lib/format";
import { createLeadForContact, openContactChat } from "@/lib/actions/contacts";
import { cn } from "@/lib/utils";
import { TagPicker } from "./tag-picker";
import type { ContactRow } from "./types";
import type { Tables } from "@/lib/types";

export function ContactHeader({
  contact,
  allTags,
  activeLeadId,
  latestLeadId,
  conversationId,
  latestQuoteId,
  latestFileId,
  counts,
}: {
  contact: ContactRow;
  allTags: Tables<"tags">[];
  activeLeadId: string | null;
  latestLeadId: string | null;
  conversationId: string | null;
  latestQuoteId: string | null;
  latestFileId: string | null;
  counts: { leads: number; quotes: number; files: number };
}) {
  const router = useRouter();
  const [openingChat, setOpeningChat] = React.useState(false);
  const [consultaOpen, setConsultaOpen] = React.useState(false);
  const [quoteOpen, setQuoteOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [destination, setDestination] = React.useState("");

  const openChat = async () => {
    if (conversationId) {
      router.push(`/crm?vista=chats&c=${conversationId}`);
      return;
    }
    setOpeningChat(true);
    const res = await openContactChat({ contactId: contact.id });
    if (!res.ok) {
      setOpeningChat(false);
      toast.error(res.error);
      return;
    }
    router.push(`/crm?vista=chats&c=${res.data.conversationId}`);
  };

  const createConsulta = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    const res = await createLeadForContact({
      contactId: contact.id,
      destination: destination.trim() || undefined,
    });
    setCreating(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setConsultaOpen(false);
    setDestination("");
    toast.success("Consulta creada. Ya está en el CRM.");
    router.refresh();
  };

  const infoItems = [
    contact.phone
      ? { icon: Phone, label: fmtPhone(contact.phone), href: `tel:+${contact.phone}` }
      : null,
    contact.email
      ? { icon: Mail, label: contact.email, href: `mailto:${contact.email}` }
      : null,
    contact.instagram
      ? {
          icon: AtSign,
          label: `@${contact.instagram.replace(/^@/, "")}`,
          href: `https://instagram.com/${contact.instagram.replace(/^@/, "")}`,
        }
      : null,
    contact.city ? { icon: MapPin, label: contact.city, href: null } : null,
  ].filter((i): i is NonNullable<typeof i> => i != null);

  const leadHref = activeLeadId
    ? `/crm/${activeLeadId}`
    : latestLeadId
      ? `/crm/${latestLeadId}`
      : null;

  return (
    <div className="animate-slide-up px-4 pt-3 md:px-6">
      <div className="flex items-start gap-4">
        <Avatar name={contact.full_name} className="size-16 text-lg md:size-20 md:text-xl" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight text-ink md:text-3xl">
              {contact.full_name}
            </h1>
            {contact.is_client && (
              <Badge className="border-tone-emerald-line bg-tone-emerald-soft text-tone-emerald-text">
                <BadgeCheck className="size-3" /> Cliente
              </Badge>
            )}
          </div>

          <div className="mt-1.5">
            <TagPicker contactId={contact.id} allTags={allTags} assigned={contact.tags} />
          </div>

          {infoItems.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              {infoItems.map((item, i) => {
                const content = (
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft">
                    <item.icon className="size-3.5 text-ink-faint" />
                    <span className="truncate">{item.label}</span>
                  </span>
                );
                return item.href ? (
                  <a
                    key={i}
                    href={item.href}
                    target={item.href.startsWith("http") ? "_blank" : undefined}
                    rel="noreferrer"
                    className="min-w-0 transition-colors hover:text-ink tap-highlight-none"
                  >
                    {content}
                  </a>
                ) : (
                  <span key={i} className="min-w-0">
                    {content}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* navegación cruzada: todo lo de esta persona, a un toque */}
      <div className="stagger-children mt-4 flex flex-wrap items-center gap-2">
        <NavChip
          icon={openingChat ? Loader2 : MessageCircle}
          label="Chat"
          onClick={openChat}
          iconClassName={openingChat ? "animate-spin" : undefined}
        />

        {leadHref ? (
          <NavChip icon={KanbanSquare} label="Consultas" count={counts.leads} href={leadHref} />
        ) : (
          <NavChip
            icon={KanbanSquare}
            label="Consultas"
            count={0}
            onClick={() => setConsultaOpen(true)}
          />
        )}

        {latestQuoteId ? (
          <NavChip
            icon={ReceiptText}
            label="Presupuestos"
            count={counts.quotes}
            href={`/presupuestos/${latestQuoteId}`}
          />
        ) : (
          <NavChip
            icon={ReceiptText}
            label="Presupuestos"
            count={0}
            onClick={() => setQuoteOpen(true)}
          />
        )}

        {latestFileId ? (
          <NavChip
            icon={FolderOpen}
            label="Files"
            count={counts.files}
            href={`/files/${latestFileId}`}
          />
        ) : (
          <Tooltip content="Cuando se gane una consulta, el file va a aparecer acá">
            <span tabIndex={0} className="inline-flex">
              <NavChip icon={FolderOpen} label="Files" count={0} muted />
            </span>
          </Tooltip>
        )}

        <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />

        <Button variant="brand" size="sm" onClick={() => setConsultaOpen(true)}>
          <Sparkles /> Nueva consulta
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setQuoteOpen(true)}>
          <ReceiptText /> Nuevo presupuesto
        </Button>
      </div>

      {/* mini-dialog nueva consulta */}
      <Dialog open={consultaOpen} onOpenChange={setConsultaOpen}>
        <DialogContent
          title="Nueva consulta"
          description={`Se crea un lead en el CRM para ${contact.full_name}.`}
        >
          <form onSubmit={createConsulta} className="space-y-4">
            <div>
              <Label htmlFor="consulta-destino">Destino (opcional)</Label>
              <Input
                id="consulta-destino"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Ej: Río de Janeiro"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConsultaOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="brand" loading={creating}>
                <Sparkles /> Crear consulta
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* cotizador embebido: presupuestar sin salir de la ficha */}
      <QuoteDialog
        open={quoteOpen}
        onOpenChange={setQuoteOpen}
        leadId={activeLeadId}
        contactId={contact.id}
        conversationId={conversationId}
        onDone={() => router.refresh()}
      />
    </div>
  );
}

/** Chip-botón de navegación cruzada: icono + label + contador. */
function NavChip({
  icon: Icon,
  label,
  count,
  href,
  onClick,
  muted,
  iconClassName,
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  href?: string;
  onClick?: () => void;
  muted?: boolean;
  iconClassName?: string;
}) {
  const inner = (
    <>
      <Icon className={cn("size-4 text-ink-faint", iconClassName)} strokeWidth={1.9} />
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-sand-soft px-1.5 text-[11px] font-semibold leading-4 tabular-nums text-ink-soft">
          {count}
        </span>
      )}
    </>
  );

  const className = cn(
    "inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-paper px-3 text-[13px] font-medium text-ink-soft",
    "transition-all duration-150 tap-highlight-none",
    muted
      ? "opacity-50"
      : "hover:border-line-strong hover:bg-sand-soft/60 hover:text-ink active:scale-[0.97]",
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={muted} className={className}>
      {inner}
    </button>
  );
}
