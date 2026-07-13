"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReceiptText, Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Skeleton, Tooltip } from "@/components/ui/misc";
import { markConversationRead, sendMessage, sendTemplate } from "@/lib/actions/messages";
import { fmtDate } from "@/lib/format";
import type { Tables } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Bubble, DayChip, groupMessagesByDay, WINDOW_MS } from "./bubble";
import { TemplatePicker } from "./template-picker";
import type { ActiveLead, MessageRow, TemplateRow } from "./types";

const MAX_COMPOSER_HEIGHT = 132; // ~5 líneas

type EmbeddedConversation = Pick<
  Tables<"conversations">,
  "id" | "agency_id" | "contact_id" | "status" | "wa_id" | "last_inbound_at" | "unread_count"
> & {
  contact: Pick<Tables<"contacts">, "id" | "full_name" | "phone"> | null;
};

/**
 * Chat autocontenido para embeber en cualquier lado (drawer del CRM, etc.).
 * Carga todo client-side, escucha realtime, envía optimista y respeta la
 * ventana de 24 hs con plantillas. El padre define la altura (h-full min-h-0).
 */
export function EmbeddedChat({
  conversationId,
  meId,
  waConnected,
  onQuoteRequest,
  className,
}: {
  conversationId: string;
  meId: string;
  waConnected: boolean;
  onQuoteRequest?: () => void;
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
  const [now, setNow] = useState(() => Date.now());

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loading = loadedId !== conversationId;
  const windowOpen =
    lastInboundAt != null && now - new Date(lastInboundAt).getTime() < WINDOW_MS;

  /* reloj: reevalúa la ventana de 24 hs cada minuto */
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

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
            "id, agency_id, contact_id, status, wa_id, last_inbound_at, unread_count, contact:contacts(id, full_name, phone)",
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
      setConversation(conv);
      setMessages((msgsRes.data ?? []).reverse());
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

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const ta = textareaRef.current;
    if (ta) ta.style.height = "auto";
    const tempId = makeOptimistic(text, "texto", null);
    const res = await sendMessage({ conversationId, body: text });
    reconcile(tempId, res);
  }

  async function handleSendTemplate(template: TemplateRow, body: string): Promise<boolean> {
    const tempId = makeOptimistic(body, "plantilla", template.meta_name);
    const res = await sendTemplate({ conversationId, templateId: template.id, body });
    const ok = reconcile(tempId, res);
    if (ok) toast.success("Plantilla enviada 📨");
    return ok;
  }

  /* ── variables de plantilla (mismo criterio que el hilo completo) ── */
  const templateVars = useMemo(
    () => ({
      nombre: conversation?.contact?.full_name.split(/\s+/)[0] ?? "cliente",
      vendedor: meName,
      destino: lead?.destination ?? "tu viaje",
      fecha: quoteValidUntil ? fmtDate(quoteValidUntil) : "los próximos días",
    }),
    [conversation, meName, lead, quoteValidUntil],
  );

  const items = useMemo(() => groupMessagesByDay(messages), [messages]);

  const quoteButton = onQuoteRequest && (
    <Tooltip content="Armar presupuesto">
      <button
        onClick={onQuoteRequest}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand-soft hover:text-brand-700 active:scale-[0.95] tap-highlight-none"
        aria-label="Armar presupuesto"
      >
        <ReceiptText className="size-5" />
      </button>
    </Tooltip>
  );

  /* ── loading: skeletons de burbujas ── */
  if (loading) {
    return (
      <div className={cn("flex h-full min-h-0 flex-col", className)}>
        <div className="min-h-0 flex-1 space-y-3 overflow-hidden chat-bg px-3 py-4">
          <Skeleton className="ml-auto h-12 w-3/5 rounded-2xl rounded-br-md" />
          <Skeleton className="h-16 w-2/3 rounded-2xl rounded-bl-md" />
          <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl rounded-br-md" />
          <Skeleton className="h-12 w-3/5 rounded-2xl rounded-bl-md" />
          <Skeleton className="ml-auto h-14 w-2/3 rounded-2xl rounded-br-md" />
        </div>
        <div className="shrink-0 border-t border-line bg-paper px-3 py-2.5">
          <Skeleton className="h-11 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className={cn("flex h-full min-h-0 flex-col items-center justify-center chat-bg", className)}>
        <p className="rounded-full border border-line bg-paper/90 px-4 py-2 text-[13px] text-ink-faint shadow-sm">
          No pudimos cargar la conversación. Probá de nuevo.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {/* mensajes */}
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain chat-bg px-3 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="rounded-full border border-line bg-paper/90 px-4 py-2 text-[13px] text-ink-faint shadow-sm">
              Todavía no hay mensajes en este chat
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 animate-fade-in">
            {items.map((item) =>
              item.type === "day" ? (
                <DayChip key={item.key} label={item.label} />
              ) : (
                <Bubble key={item.msg.id} m={item.msg} />
              ),
            )}
          </div>
        )}
      </div>

      {/* footer: composer o plantillas según la ventana de 24 hs */}
      <div className="shrink-0">
        {conversation.status === "cerrada" && (
          <p className="border-t border-line bg-sand-soft/70 px-4 py-1.5 text-center text-[12px] text-ink-faint">
            Esta conversación está cerrada
          </p>
        )}
        {windowOpen ? (
          <div className="border-t border-line bg-paper px-3 py-2.5">
            <div className="flex items-end gap-2">
              {quoteButton}
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
                placeholder={waConnected ? "Escribí un mensaje…" : "Escribí un mensaje… (envío simulado)"}
                aria-label="Mensaje"
                className="max-h-[132px] min-h-[44px] flex-1 resize-none rounded-2xl border border-line bg-cream px-3.5 py-2.5 text-[15px] leading-snug text-ink transition-colors placeholder:text-ink-faint focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              />
              <button
                onClick={handleSend}
                disabled={draft.trim().length === 0}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm transition-all hover:bg-brand-700 active:scale-[0.95] disabled:opacity-40 tap-highlight-none"
                aria-label="Enviar mensaje"
              >
                <Send className="size-5 -translate-x-px translate-y-px" />
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2 text-[12.5px] leading-snug text-amber-800">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <p className="flex-1">
                <span className="font-semibold">Fuera de la ventana de 24 hs</span> — solo se
                pueden enviar plantillas aprobadas.
              </p>
              {onQuoteRequest && (
                <Tooltip content="Armar presupuesto">
                  <button
                    onClick={onQuoteRequest}
                    className="-my-1 flex size-9 shrink-0 items-center justify-center rounded-full text-amber-800 transition-colors hover:bg-amber-100 active:scale-[0.95] tap-highlight-none"
                    aria-label="Armar presupuesto"
                  >
                    <ReceiptText className="size-4.5" />
                  </button>
                </Tooltip>
              )}
            </div>
            <div className="border-t border-line bg-paper px-3 py-3">
              <TemplatePicker
                templates={templates}
                vars={templateVars}
                onSend={handleSendTemplate}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
