"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Clock, ReceiptText, Send, StickyNote, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/misc";
import { WhatsAppIcon } from "@/components/quotes/wa-icon";
import { markConversationRead, sendMessage, sendTemplate } from "@/lib/actions/messages";
import { sendInternalNote } from "@/lib/actions/crm-panel";
import { fmtDate } from "@/lib/format";
import type { Tables } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Bubble, DayChip, groupMessagesIntoDayGroups, startsStreak, WINDOW_MS } from "./bubble";
import { TemplatePicker } from "./template-picker";
import type { ActiveLead, MessageRow, TemplateRow } from "./types";

const MAX_COMPOSER_HEIGHT = 132; // ~5 líneas

/** Placeholders de una plantilla: `{{destino}}` — mismo patrón que fillTemplate. */
const TEMPLATE_VAR_RE = /\{\{(\w+)\}\}/g;

/** Cómo nombrarle al vendedor cada variable que falta. */
const VAR_LABELS: Record<string, string> = {
  nombre: "el nombre del contacto",
  vendedor: "tu nombre",
  destino: "el destino del lead",
  fecha: "la fecha del presupuesto",
};

/**
 * Capacidad REAL de enviar, calculada en el server (donde se leen las envs del
 * worker y las credenciales de Meta). `agency.settings.whatsapp.connected` no
 * alcanza: es una preferencia guardada, no la infraestructura viva.
 */
export type WaSendCapability = {
  /** worker de Baileys configurado: los números de las sucursales */
  worker: boolean;
  /** Cloud API de Meta configurada: el número madre */
  cloud: boolean;
  /** cuenta de Instagram conectada: los DMs */
  instagram: boolean;
};

type EmbeddedConversation = Pick<
  Tables<"conversations">,
  | "id"
  | "agency_id"
  | "contact_id"
  | "status"
  | "channel"
  | "wa_id"
  | "last_inbound_at"
  | "unread_count"
> & {
  contact: Pick<Tables<"contacts">, "id" | "full_name" | "phone"> | null;
  /** por qué canal sale el mensaje: define si aplica la ventana de 24 hs */
  channel_ref: Pick<
    Tables<"wa_channels">,
    "id" | "kind" | "label" | "status" | "phone_number_id"
  > | null;
};

/** Aviso persistente cuando el mensaje no puede salir. */
type SendBlock = {
  title: string;
  detail: string;
  link: { href: string; label: string } | null;
};

/**
 * Espejo de resolveRoute (lib/actions/messages): el vendedor se entera de que
 * el mensaje no va a salir ANTES de escribirlo, no con un toast rojo después.
 */
function sendBlock(
  conversation: EmbeddedConversation | null,
  waSend: WaSendCapability,
): SendBlock | null {
  if (!conversation) return null;
  const channel = conversation.channel_ref;

  // Instagram va primero y con su propia lógica: acá el destinatario no es un
  // teléfono sino el IGSID de la persona (`wa_id`), así que un contacto sin
  // teléfono cargado no impide nada.
  //
  // Se mira también `conversation.channel`: si alguien borró y rehizo el canal,
  // la conversación queda sin `channel_ref` (la FK es ON DELETE SET NULL) y sin
  // esto el chat mandaría al vendedor a configurar sucursales de WhatsApp.
  if (channel?.kind === "instagram" || (!channel && conversation.channel === "instagram")) {
    if (!waSend.instagram)
      return {
        title: "Instagram sin conectar",
        detail:
          "Todavía no está conectada la cuenta de Instagram, así que los mensajes no salen.",
        link: { href: "/config/instagram", label: "Configuración · Instagram" },
      };
    if (!conversation.wa_id)
      return {
        title: "Chat sin identificar",
        detail:
          "Este chat no tiene el identificador de Instagram de la persona. Se completa solo cuando vuelva a escribir.",
        link: null,
      };
    return null;
  }

  const to = conversation.contact?.phone ?? conversation.wa_id;

  if (!to)
    return {
      title: "Sin teléfono",
      detail: "Este contacto no tiene número cargado, así que el mensaje no puede salir.",
      link: conversation.contact
        ? { href: `/clientes/${conversation.contact.id}`, label: "Cargalo en su ficha" }
        : null,
    };

  if (!channel)
    return {
      title: "Sin número de salida",
      detail: "Este chat todavía no tiene un WhatsApp asignado para responder.",
      link: { href: "/config/sucursales", label: "Configuración · Sucursales" },
    };

  if (channel.kind === "baileys") {
    if (channel.status !== "conectado")
      return {
        title: "Número sin vincular",
        detail: `El WhatsApp de ${channel.label} no está vinculado, así que no sale nada por acá.`,
        link: { href: "/config/sucursales", label: "Vinculalo con el QR" },
      };
    if (!waSend.worker)
      return {
        title: "Servicio de WhatsApp caído",
        detail:
          "El servicio que maneja los números de las sucursales no está disponible. Avisale a quien administra el sistema.",
        link: null,
      };
    return null;
  }

  if (!waSend.cloud || !channel.phone_number_id)
    return {
      title: "Número madre sin conectar",
      detail:
        "Todavía no está conectada la API de WhatsApp del número madre, así que los mensajes no salen.",
      link: { href: "/config/whatsapp", label: "Configuración · WhatsApp" },
    };

  return null;
}

/**
 * Chat autocontenido para embeber en cualquier lado (drawer del CRM, etc.).
 * Carga todo client-side, escucha realtime, envía optimista y respeta la
 * ventana de 24 hs con plantillas. El padre define la altura (h-full min-h-0).
 * Visual: clon de WhatsApp Web (wallpaper oficial + tokens wa-*).
 */
export function EmbeddedChat({
  conversationId,
  meId,
  waSend,
  onQuoteRequest,
  onBridgeRequest,
  className,
}: {
  conversationId: string;
  meId: string;
  waSend: WaSendCapability;
  onQuoteRequest?: () => void;
  /** si viene, en los chats de Instagram aparece el pase a WhatsApp */
  onBridgeRequest?: () => void;
  className?: string;
}) {
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<EmbeddedConversation | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [lead, setLead] = useState<ActiveLead | null>(null);
  const [meName, setMeName] = useState("");
  const [quoteValidUntil, setQuoteValidUntil] = useState<string | null>(null);
  const [lastInboundAt, setLastInboundAt] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [noteMode, setNoteMode] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // ids presentes en la carga inicial: los que lleguen después animan con msg-in
  const [initialIds, setInitialIds] = useState<Set<string>>(() => new Set());

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // reset del composer al cambiar de conversación (ajuste de estado durante el render)
  const [prevConversationId, setPrevConversationId] = useState(conversationId);
  if (prevConversationId !== conversationId) {
    setPrevConversationId(conversationId);
    setNoteMode(false);
    setDraft("");
  }

  const loading = loadedId !== conversationId;
  /* ¿puede salir el mensaje? Mismo criterio que el server: si no, el composer
     avisa y no deja mandar (antes se guardaba como "enviado" sin salir). */
  const blocked = useMemo(() => sendBlock(conversation, waSend), [conversation, waSend]);
  const canSend = conversation != null && blocked == null;
  const isInstagram =
    conversation?.channel_ref?.kind === "instagram" || conversation?.channel === "instagram";
  /* La ventana de 24 hs es una regla de Meta y aplica a sus dos canales: el
     número madre (Cloud API) e Instagram. Por el número de una sucursal
     (Baileys) se escribe siempre — el seguimiento no se paga — y si el canal de
     Meta no está conectado, la ventana no puede tapar el primer mensaje. */
  const windowApplies = canSend && conversation?.channel_ref?.kind !== "baileys";
  const windowOpen =
    !windowApplies ||
    (lastInboundAt != null && now - new Date(lastInboundAt).getTime() < WINDOW_MS);

  /* reloj: reevalúa la ventana de 24 hs cada minuto (solo si aplica) */
  useEffect(() => {
    if (!windowApplies) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [windowApplies]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  /* ── carga inicial (client-side, todo en paralelo) ── */
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      const [convRes, msgsRes, tplRes, meRes] = await Promise.all([
        supabase
          .from("conversations")
          .select(
            "id, agency_id, contact_id, status, channel, wa_id, last_inbound_at, unread_count, contact:contacts(id, full_name, phone), channel_ref:wa_channels(id, kind, label, status, phone_number_id)",
          )
          .eq("id", conversationId)
          .maybeSingle(),
        supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase.from("wa_templates").select("*").eq("is_approved", true).order("name"),
        supabase.from("members").select("display_name").eq("id", meId).maybeSingle(),
      ]);

      const conv = (convRes.data ?? null) as EmbeddedConversation | null;

      // lead activo del contacto + vencimiento del último presupuesto (variables de plantilla)
      let activeLead: ActiveLead | null = null;
      let validUntil: string | null = null;
      if (conv?.contact_id) {
        const { data: leadData } = await supabase
          .from("leads")
          .select("id, destination, stage, next_action, next_action_at")
          .eq("contact_id", conv.contact_id)
          .in("stage", ["nuevo", "contactado", "presupuestado", "negociacion"])
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        activeLead = leadData ?? null;
        if (activeLead) {
          const { data: quoteData } = await supabase
            .from("quotes")
            .select("valid_until")
            .eq("lead_id", activeLead.id)
            .not("valid_until", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          validUntil = quoteData?.valid_until ?? null;
        }
      }

      if (cancelled) return;
      const initialMsgs = (msgsRes.data ?? []).reverse();
      setInitialIds(new Set(initialMsgs.map((m) => m.id)));
      setConversation(conv);
      setMessages(initialMsgs);
      setTemplates(tplRes.data ?? []);
      setMeName(meRes.data?.display_name ?? "");
      setLead(activeLead);
      setQuoteValidUntil(validUntil);
      setLastInboundAt(conv?.last_inbound_at ?? null);
      setLoadedId(conversationId);
      if (conv && conv.unread_count > 0) {
        markConversationRead({ conversationId: conv.id });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, meId]);

  /* al terminar de cargar: arrancar apoyado en el fondo */
  useEffect(() => {
    if (!loading) requestAnimationFrame(() => scrollToBottom(false));
  }, [loading, scrollToBottom]);

  /* ── realtime: mensajes nuevos y cambios de estado (ticks) ── */
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`messages:${conversationId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const m = payload.new as MessageRow;
          const el = listRef.current;
          const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 160;
          setMessages((prev) => {
            if (prev.some((p) => p.id === m.id)) return prev;
            // el propio optimista puede llegar por realtime antes de que confirme la action
            if (
              m.direction === "out" &&
              prev.some((p) => p.id.startsWith("temp-") && p.body === m.body)
            )
              return prev;
            return [...prev, m];
          });
          if (m.direction === "in") {
            setLastInboundAt(m.created_at);
            markConversationRead({ conversationId });
          }
          if (nearBottom || m.direction === "out") {
            requestAnimationFrame(() => scrollToBottom(true));
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const m = payload.new as MessageRow;
          setMessages((prev) => prev.map((p) => (p.id === m.id ? { ...p, ...m } : p)));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, scrollToBottom]);

  /* ── envío optimista ── */

  function makeOptimistic(body: string, kind: MessageRow["kind"], templateName: string | null) {
    const optimistic: MessageRow = {
      id: `temp-${crypto.randomUUID()}`,
      agency_id: conversation?.agency_id ?? "",
      conversation_id: conversationId,
      body,
      created_at: new Date().toISOString(),
      direction: "out",
      error_detail: null,
      is_automated: false,
      kind,
      media_url: null,
      metadata: {},
      sent_by: meId,
      status: "pendiente",
      template_name: templateName,
      wa_message_id: null,
    };
    setMessages((prev) => [...prev, optimistic]);
    requestAnimationFrame(() => scrollToBottom(true));
    return optimistic.id;
  }

  function reconcile(
    tempId: string,
    res: Awaited<ReturnType<typeof sendMessage>>,
  ): boolean {
    if (!res.ok) {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, status: "fallido" as const } : m)),
      );
      toast.error(res.error);
      return false;
    }
    setMessages((prev) => {
      // si el realtime ya trajo el mensaje real, descartamos el optimista
      if (prev.some((m) => m.id === res.data.id)) return prev.filter((m) => m.id !== tempId);
      return prev.map((m) =>
        m.id === tempId
          ? { ...m, id: res.data.id, status: res.data.status, created_at: res.data.createdAt }
          : m,
      );
    });
    return true;
  }

  function resetComposer() {
    setDraft("");
    const ta = textareaRef.current;
    if (ta) ta.style.height = "auto";
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    if (noteMode) {
      // la nota interna no sale de la app: no depende de WhatsApp
      resetComposer();
      const tempId = makeOptimistic(text, "nota_interna", null);
      const res = await sendInternalNote({ conversationId, body: text });
      if (reconcile(tempId, res)) setNoteMode(false);
      return;
    }
    if (blocked) {
      // sin capacidad de envío no inventamos una burbuja: el texto queda
      // escrito para que no se pierda mientras se arregla el número
      toast.error(`${blocked.title}. ${blocked.detail}`);
      return;
    }
    resetComposer();
    const tempId = makeOptimistic(text, "texto", null);
    const res = await sendMessage({ conversationId, body: text });
    reconcile(tempId, res);
  }

  async function handleSendTemplate(template: TemplateRow, body: string): Promise<boolean> {
    const tempId = makeOptimistic(body, "plantilla", template.meta_name);
    const res = await sendTemplate({ conversationId, templateId: template.id, body });
    const ok = reconcile(tempId, res);
    if (ok) toast.success("Plantilla enviada");
    return ok;
  }

  /* ── variables de plantilla ──
     Solo las que se pueden completar de verdad: mandarle "tu viaje" o "los
     próximos días" a un cliente real es peor que no mandar nada. Lo que falta
     queda afuera del mapa y la plantilla que lo necesita no se ofrece. */
  const templateVars = useMemo(() => {
    const vars: Record<string, string> = {};
    const nombre = conversation?.contact?.full_name.trim().split(/\s+/)[0];
    if (nombre) vars.nombre = nombre;
    if (meName.trim()) vars.vendedor = meName.trim();
    if (lead?.destination?.trim()) vars.destino = lead.destination.trim();
    if (quoteValidUntil) vars.fecha = fmtDate(quoteValidUntil);
    return vars;
  }, [conversation, meName, lead, quoteValidUntil]);

  /* Plantillas enviables (todas sus variables resueltas) y qué datos faltan
     para las otras: nunca se manda un placeholder inventado. */
  const { readyTemplates, missingVars } = useMemo(() => {
    const missing = new Set<string>();
    const ready = templates.filter((t) => {
      const holes = [...t.body.matchAll(TEMPLATE_VAR_RE)]
        .map((m) => m[1])
        .filter((v) => templateVars[v] == null);
      for (const v of holes) missing.add(v);
      return holes.length === 0;
    });
    return { readyTemplates: ready, missingVars: [...missing] };
  }, [templates, templateVars]);

  const missingVarsLabel = missingVars
    .map((v) => VAR_LABELS[v] ?? `{{${v}}}`)
    .join(", ");

  const dayGroups = useMemo(() => groupMessagesIntoDayGroups(messages), [messages]);

  /* ── botones auxiliares del composer ── */

  const noteToggle = (
    <Tooltip content={noteMode ? "Volver al mensaje" : "Nota interna (no la ve el cliente)"}>
      <button
        type="button"
        onClick={() => setNoteMode((v) => !v)}
        aria-pressed={noteMode}
        aria-label="Nota interna"
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full transition-colors active:scale-95 tap-highlight-none",
          noteMode
            ? "bg-tone-amber-soft text-tone-amber-text"
            : "text-wa-ink-soft hover:bg-wa-hover",
        )}
      >
        <StickyNote className="size-5" strokeWidth={1.9} />
      </button>
    </Tooltip>
  );

  const quoteButton = onQuoteRequest && (
    <Tooltip content="Armar presupuesto">
      <button
        type="button"
        onClick={onQuoteRequest}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-wa-ink-soft transition-colors hover:bg-wa-hover active:scale-95 tap-highlight-none"
        aria-label="Armar presupuesto"
      >
        <ReceiptText className="size-5" strokeWidth={1.9} />
      </button>
    </Tooltip>
  );

  /* El movimiento que cierra la venta: Instagram trae la consulta, WhatsApp la
     trabaja. Va en verde y siempre a la vista dentro de un chat de Instagram,
     no escondido en un menú. */
  const bridgeButton = isInstagram && onBridgeRequest && (
    <Tooltip content="Seguir la charla por WhatsApp">
      <button
        type="button"
        onClick={onBridgeRequest}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-wa-accent transition-colors hover:bg-wa-hover active:scale-95 tap-highlight-none"
        aria-label="Pasar a WhatsApp"
      >
        <WhatsAppIcon className="size-5" />
      </button>
    </Tooltip>
  );

  /* Aviso persistente: queda arriba del composer todo el tiempo que el chat no
     pueda enviar. Un placeholder no alcanza — desaparece al primer tecleo. */
  const sendNotice = blocked && (
    <div className="flex items-start gap-2.5 border-b border-wa-line bg-wa-panel-alt px-4 py-2.5 text-[12.5px] leading-snug text-wa-ink-soft">
      <TriangleAlert
        className="mt-0.5 size-4 shrink-0 text-tone-amber-text"
        strokeWidth={1.9}
      />
      <p className="flex-1">
        <span className="font-semibold text-wa-ink">{blocked.title}</span> —{" "}
        {blocked.detail}
        {blocked.link && (
          <>
            {" "}
            <Link
              href={blocked.link.href}
              className="font-medium text-wa-accent-deep underline underline-offset-2"
            >
              {blocked.link.label}
            </Link>
          </>
        )}
      </p>
    </div>
  );

  const composerBar = (
    <div className="shrink-0 bg-wa-panel-alt px-2.5 py-2 md:px-4">
      <div className="flex items-end gap-1">
        {noteToggle}
        {quoteButton}
        {bridgeButton}
        <div
          className={cn(
            "flex min-w-0 flex-1 items-end rounded-lg transition-colors",
            noteMode
              ? "bg-tone-amber-soft ring-1 ring-tone-amber-line"
              : "bg-wa-panel focus-within:ring-1 focus-within:ring-wa-ink-faint/25",
          )}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            placeholder={noteMode ? "Escribí una nota interna…" : "Escribí un mensaje"}
            aria-label={noteMode ? "Nota interna" : "Mensaje"}
            className="max-h-[132px] min-h-[44px] w-full resize-none bg-transparent px-3.5 py-[11px] text-[15px] leading-snug text-wa-ink outline-none placeholder:text-wa-ink-faint"
          />
        </div>
        <button
          onClick={handleSend}
          disabled={draft.trim().length === 0}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 tap-highlight-none",
            noteMode ? "bg-amber-500" : "bg-wa-accent",
          )}
          aria-label={noteMode ? "Guardar nota interna" : "Enviar mensaje"}
        >
          {noteMode ? (
            <StickyNote className="size-5" />
          ) : (
            <Send className="size-5 -translate-x-px translate-y-px" />
          )}
        </button>
      </div>
      {noteMode && (
        <p className="mt-1 pl-1 text-[11px] text-tone-amber-text animate-fade-in">
          Nota interna — el cliente no la ve, queda en el hilo y en el historial.
        </p>
      )}
    </div>
  );

  /* ── loading: skeletons de burbujas sobre el wallpaper ── */
  if (loading) {
    return (
      <div className={cn("flex h-full min-h-0 flex-col", className)}>
        <div className="min-h-0 flex-1 space-y-2.5 overflow-hidden wa-wallpaper px-[6%] py-4">
          <div className="ml-auto h-12 w-3/5 animate-pulse rounded-lg bg-wa-bubble-out/70" />
          <div className="h-16 w-2/3 animate-pulse rounded-lg bg-wa-bubble-in/70" />
          <div className="ml-auto h-10 w-1/2 animate-pulse rounded-lg bg-wa-bubble-out/70" />
          <div className="h-12 w-3/5 animate-pulse rounded-lg bg-wa-bubble-in/70" />
          <div className="ml-auto h-14 w-2/3 animate-pulse rounded-lg bg-wa-bubble-out/70" />
        </div>
        <div className="shrink-0 bg-wa-panel-alt px-3 py-2.5">
          <div className="h-11 w-full animate-pulse rounded-lg bg-wa-panel/80" />
        </div>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 flex-col items-center justify-center wa-wallpaper",
          className,
        )}
      >
        <p className="rounded-lg bg-wa-panel-alt/95 px-4 py-2 text-[13px] text-wa-ink-soft shadow-sm">
          No pudimos cargar la conversación. Probá de nuevo.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {/* hilo sobre el wallpaper oficial */}
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain wa-wallpaper px-[5%] py-2 md:px-[7%]"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="rounded-lg bg-wa-panel-alt/95 px-4 py-2 text-[13px] text-wa-ink-soft shadow-sm">
              Todavía no hay mensajes en este chat
            </p>
          </div>
        ) : (
          <div className="animate-fade-in">
            {dayGroups.map((g) => (
              <div key={g.key}>
                <DayChip label={g.label} />
                <div className="flex flex-col">
                  {g.msgs.map((m, i) => (
                    <Bubble
                      key={m.id}
                      m={m}
                      tail={startsStreak(g.msgs[i - 1], m)}
                      fresh={!initialIds.has(m.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* footer: composer o plantillas según la ventana de 24 hs */}
      <div className="shrink-0">
        {conversation.status === "cerrada" && (
          <p className="border-b border-wa-line bg-wa-panel-alt px-4 py-1.5 text-center text-[12px] text-wa-ink-faint">
            Esta conversación está cerrada
          </p>
        )}
        {windowOpen ? (
          <>
            {!noteMode && sendNotice}
            {composerBar}
          </>
        ) : noteMode ? (
          composerBar
        ) : isInstagram ? (
          /* En Instagram no hay plantillas pagas: fuera de las 24 hs la salida
             es WhatsApp (o esperar a que la persona vuelva a escribir). Ofrecer
             un TemplatePicker acá sería ofrecer algo que no existe. */
          <>
            <div className="flex items-start gap-2.5 bg-wa-panel-alt px-4 py-2.5 text-[12.5px] leading-snug text-wa-ink-soft">
              <Clock className="mt-0.5 size-4 shrink-0 text-wa-ink-faint" />
              <p className="flex-1">
                <span className="font-semibold text-wa-ink">
                  Se cerró la ventana de 24 hs
                </span>{" "}
                — Instagram no deja escribir hasta que la persona vuelva a
                mandar un mensaje.
              </p>
              <Tooltip content="Nota interna (no la ve el cliente)">
                <button
                  type="button"
                  onClick={() => setNoteMode(true)}
                  className="-my-1 flex size-9 shrink-0 items-center justify-center rounded-full text-wa-ink-soft transition-colors hover:bg-wa-hover active:scale-95 tap-highlight-none"
                  aria-label="Nota interna"
                >
                  <StickyNote className="size-4.5" strokeWidth={1.9} />
                </button>
              </Tooltip>
            </div>
            <div className="border-t border-wa-line bg-wa-panel-alt px-3 py-3 md:px-4">
              {onBridgeRequest ? (
                <>
                  <Button variant="whatsapp" onClick={onBridgeRequest} className="w-full">
                    <WhatsAppIcon className="size-4" />
                    Seguir por WhatsApp
                  </Button>
                  <p className="mt-2 px-1 text-center text-[11.5px] leading-snug text-wa-ink-faint">
                    Le escribís desde el número de la sucursal: ahí no hay ventana de 24 hs.
                  </p>
                </>
              ) : (
                <p className="px-1 py-2 text-center text-[13px] leading-relaxed text-wa-ink-faint">
                  Esperá a que la persona escriba para poder contestarle.
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-2.5 bg-wa-panel-alt px-4 py-2.5 text-[12.5px] leading-snug text-wa-ink-soft">
              <Clock className="mt-0.5 size-4 shrink-0 text-wa-ink-faint" />
              <p className="flex-1">
                <span className="font-semibold text-wa-ink">Ventana de 24 hs cerrada</span> —
                respondé con una plantilla aprobada; el chat se reabre cuando el cliente
                escribe.
              </p>
              <Tooltip content="Nota interna (no la ve el cliente)">
                <button
                  type="button"
                  onClick={() => setNoteMode(true)}
                  className="-my-1 flex size-9 shrink-0 items-center justify-center rounded-full text-wa-ink-soft transition-colors hover:bg-wa-hover active:scale-95 tap-highlight-none"
                  aria-label="Nota interna"
                >
                  <StickyNote className="size-4.5" strokeWidth={1.9} />
                </button>
              </Tooltip>
              {onQuoteRequest && (
                <Tooltip content="Armar presupuesto">
                  <button
                    type="button"
                    onClick={onQuoteRequest}
                    className="-my-1 flex size-9 shrink-0 items-center justify-center rounded-full text-wa-ink-soft transition-colors hover:bg-wa-hover active:scale-95 tap-highlight-none"
                    aria-label="Armar presupuesto"
                  >
                    <ReceiptText className="size-4.5" strokeWidth={1.9} />
                  </button>
                </Tooltip>
              )}
            </div>
            <div className="border-t border-wa-line bg-wa-panel-alt px-3 py-3 md:px-4">
              {templates.length > 0 && readyTemplates.length === 0 ? (
                <p className="px-1 py-2 text-center text-[13px] leading-relaxed text-wa-ink-faint">
                  Las plantillas aprobadas necesitan datos que todavía no están
                  cargados ({missingVarsLabel}). Completalos en el lead para poder
                  usarlas.
                </p>
              ) : (
                <>
                  <TemplatePicker
                    templates={readyTemplates}
                    vars={templateVars}
                    onSend={handleSendTemplate}
                  />
                  {missingVars.length > 0 && (
                    <p className="mt-2 px-1 text-[11.5px] leading-snug text-wa-ink-faint">
                      Hay plantillas que no aparecen porque falta {missingVarsLabel}.
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
