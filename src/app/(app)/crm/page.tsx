import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CrmBoard, type CrmView } from "@/components/crm/crm-board";
import type { BoardLead, LeadConversation, MemberOption } from "@/components/crm/types";
import type { WaSendCapability } from "@/components/chats/embedded-chat";
import {
  CONVERSATION_SELECT,
  type BranchOption,
  type ConversationRow,
} from "@/components/chats/types";
import { hasCloudApi } from "@/lib/wa/cloud-credentials";
import { hasInstagram } from "@/lib/ig/credentials";
import { hasWorker } from "@/lib/wa/worker";

export const metadata = { title: "CRM" };

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; c?: string }>;
}) {
  const { vista, c } = await searchParams;
  const { member, agency, isAdmin } = await requireMember();
  const supabase = await createClient();

  const [leadsRes, membersRes, convsRes, branchesRes, cloudReady, igReady] = await Promise.all([
    supabase
      .from("leads")
      .select(
        `id, stage, position, destination, origin_channel, origin_campaign,
         next_action_at, created_at, pax_adults, pax_children, assigned_to, won_file_id,
         budget_estimate, budget_currency,
         contact:contacts(id, full_name, phone),
         assignee:members!leads_assigned_to_fkey(id, display_name)`,
      )
      .order("position", { ascending: true }),
    supabase
      .from("members")
      .select("id, display_name, role")
      .eq("is_active", true)
      .order("display_name"),
    // bandeja completa (misma query que usaba /chats): alimenta la vista Chats,
    // el badge de no leídos y las tarjetas del kanban
    supabase
      .from("conversations")
      .select(CONVERSATION_SELECT)
      .order("last_message_at", { ascending: false, nullsFirst: false }),
    // sucursales activas + su número: filtro de la bandeja y derivación
    supabase
      .from("branches")
      .select("id, name, color, position, channels:wa_channels(id, kind, status, phone)")
      .eq("is_active", true)
      .order("position", { ascending: true }),
    // ¿tiene esta agencia el número madre conectado con Meta? Va acá adentro a
    // propósito: es la ruta más caliente del sistema y no puede pagar un viaje
    // secuencial más.
    hasCloudApi(agency.id),
    // lo mismo para los DMs de Instagram
    hasInstagram(agency.id),
  ]);

  const conversations = (convsRes.data ?? []) as unknown as ConversationRow[];

  /* Conversación de WhatsApp por contacto para las tarjetas del kanban.
     Un contacto puede tener DOS hilos (número madre y sucursal): la tarjeta
     tiene que abrir el MISMO que ensureConversation — la sucursal manda y,
     entre iguales, el del último mensaje (el sort es estable y la query ya
     viene por last_message_at desc). */
  const convByContact = new Map<string, LeadConversation>();
  const whatsappConvs = conversations
    .filter((c) => c.channel === "whatsapp")
    .sort((a, b) => Number(b.branch_id != null) - Number(a.branch_id != null));
  for (const conv of whatsappConvs) {
    if (convByContact.has(conv.contact_id)) continue;
    convByContact.set(conv.contact_id, {
      id: conv.id,
      last_message_preview: conv.last_message_preview,
      last_message_at: conv.last_message_at,
      last_inbound_at: conv.last_inbound_at,
      unread_count: conv.unread_count,
    });
  }

  const leads: BoardLead[] = (leadsRes.data ?? [])
    .filter((l) => l.contact != null)
    .map((l) => ({
      id: l.id,
      stage: l.stage,
      position: Number(l.position),
      destination: l.destination,
      origin_channel: l.origin_channel,
      origin_campaign: l.origin_campaign,
      next_action_at: l.next_action_at,
      created_at: l.created_at,
      pax_adults: l.pax_adults,
      pax_children: l.pax_children,
      assigned_to: l.assigned_to,
      won_file_id: l.won_file_id,
      budget_estimate: l.budget_estimate != null ? Number(l.budget_estimate) : null,
      budget_currency: l.budget_currency,
      contact: l.contact!,
      assignee: l.assignee,
      conversation: convByContact.get(l.contact!.id) ?? null,
    }));

  const members: MemberOption[] = membersRes.data ?? [];

  // el número de la sucursal es siempre el de Baileys (el madre no tiene sucursal)
  const branches: BranchOption[] = (branchesRes.data ?? []).map((b) => {
    const channel = (b.channels ?? []).find((c) => c.kind === "baileys") ?? null;
    return {
      id: b.id,
      name: b.name,
      color: b.color,
      channel: channel
        ? { id: channel.id, status: channel.status, phone: channel.phone }
        : null,
    };
  });

  /* Capacidad REAL de enviar. `settings.whatsapp.connected` es una preferencia
     guardada, no la infraestructura viva: sin worker el número de una sucursal
     no manda nada, sin las credenciales de Meta de ESTA agencia el madre
     tampoco, y sin la cuenta de Instagram conectada los DMs no salen. El chat lo
     cruza con el canal de cada conversación. */
  const waSend: WaSendCapability = {
    worker: hasWorker(),
    cloud: cloudReady,
    instagram: igReady,
  };

  // ?vista= manda; un deep link con ?c= solo también abre Chats.
  // null = sin preferencia en la URL → el board usa la última vista guardada.
  const initialView: CrmView | null =
    vista === "pipeline" || vista === "chats" || vista === "embudo"
      ? vista
      : c
        ? "chats"
        : null;

  return (
    <CrmBoard
      initialLeads={leads}
      initialConversations={conversations}
      members={members}
      branches={branches}
      meId={member.id}
      isAdmin={isAdmin}
      agencyId={agency.id}
      waSend={waSend}
      initialView={initialView}
      initialConversationId={c ?? null}
    />
  );
}
