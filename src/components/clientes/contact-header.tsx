"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MessageCircle,
  Sparkles,
  ReceiptText,
  Phone,
  Mail,
  AtSign,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/misc";
import { fmtPhone } from "@/lib/format";
import { createLeadForContact, openContactChat } from "@/lib/actions/contacts";
import { TagPicker } from "./tag-picker";
import type { ContactRow } from "./types";
import type { Tables } from "@/lib/types";

export function ContactHeader({
  contact,
  allTags,
  activeLeadId,
}: {
  contact: ContactRow;
  allTags: Tables<"tags">[];
  activeLeadId: string | null;
}) {
  const router = useRouter();
  const [openingChat, setOpeningChat] = React.useState(false);
  const [consultaOpen, setConsultaOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [destination, setDestination] = React.useState("");

  const openChat = async () => {
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
    toast.success("Consulta creada ✨ Ya está en el CRM.");
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
              <Badge className="border-money-100 bg-money-50 text-money-700">Cliente</Badge>
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

      {/* acciones */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="whatsapp" size="sm" loading={openingChat} onClick={openChat}>
          <MessageCircle /> Chat
        </Button>

        <Button variant="brand" size="sm" onClick={() => setConsultaOpen(true)}>
          <Sparkles /> Nueva consulta
        </Button>

        {activeLeadId ? (
          <Link
            href={`/presupuestos/nuevo?lead=${activeLeadId}`}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            <ReceiptText /> Presupuestar
          </Link>
        ) : (
          <Tooltip content="Primero creá una consulta para poder presupuestar">
            <span tabIndex={0} className="inline-flex">
              <Button variant="secondary" size="sm" disabled>
                <ReceiptText /> Presupuestar
              </Button>
            </span>
          </Tooltip>
        )}
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
    </div>
  );
}
