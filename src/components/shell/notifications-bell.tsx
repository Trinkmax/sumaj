"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  Banknote,
  Bell,
  BellRing,
  Cake,
  CheckCheck,
  IdCard,
  PlaneTakeoff,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/misc";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Tables } from "@/lib/types";

type Notification = Tables<"notifications">;

const TYPE_META: Record<string, { icon: LucideIcon; tone: string }> = {
  lead_nuevo: { icon: Sparkles, tone: "bg-tone-sky-soft text-tone-sky-text" },
  seguimiento: { icon: AlarmClock, tone: "bg-tone-amber-soft text-tone-amber-text" },
  documento: { icon: IdCard, tone: "bg-tone-violet-soft text-tone-violet-text" },
  salida: { icon: PlaneTakeoff, tone: "bg-brand-tint text-brand-text" },
  pago: { icon: Banknote, tone: "bg-money-tint text-money-text" },
  cumpleanos: { icon: Cake, tone: "bg-tone-rose-soft text-tone-rose-text" },
  general: { icon: BellRing, tone: "bg-sand-soft text-ink-soft" },
};

// La campana se monta dos veces (header mobile + flotante desktop):
// dedupe de toasts a nivel módulo para no avisar doble.
const toastedIds = new Set<string>();

export function NotificationsBell({ memberId }: { memberId: string }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(15);
    setItems(data ?? []);
  }, [memberId]);

  useEffect(() => {
    load();
    const supabase = createClient();
    // nombre único por montaje: el cliente de supabase es singleton y
    // reutilizar el nombre de un canal ya suscripto lanza excepción
    const channel = supabase
      .channel(`notifications:${memberId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `member_id=eq.${memberId}`,
        },
        (payload) => {
          const n = payload.new as Notification;
          setItems((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev].slice(0, 15)));
          if (!toastedIds.has(n.id)) {
            toastedIds.add(n.id);
            toast(n.title, { description: n.body ?? undefined });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [memberId, load]);

  const unread = items.filter((n) => !n.read_at).length;

  async function markAllRead() {
    if (unread === 0) return;
    const supabase = createClient();
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("member_id", memberId)
      .is("read_at", null);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) markAllRead();
      }}
    >
      <PopoverTrigger asChild>
        <button
          className="relative rounded-full p-2 text-ink-soft transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
          aria-label="Notificaciones"
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4.5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white animate-pop">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-sm font-semibold text-ink">Notificaciones</p>
          {unread > 0 && (
            <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-medium text-brand-text">
              {unread} sin leer
            </span>
          )}
        </div>
        <div className="max-h-[400px] overflow-y-auto border-t border-line">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-money-tint text-money-text">
                <CheckCheck className="size-5" />
              </span>
              <p className="text-sm text-ink-faint">Todo al día</p>
            </div>
          ) : (
            items.map((n) => {
              const meta = TYPE_META[n.type] ?? TYPE_META.general;
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    setOpen(false);
                    markAllRead();
                    if (n.link) router.push(n.link);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-sand-soft/60 tap-highlight-none",
                    !n.read_at && "bg-brand-tint/40",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                      meta.tone,
                    )}
                  >
                    <meta.icon className="size-4" strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium leading-snug text-ink">
                      {n.title}
                    </span>
                    {n.body && (
                      <span className="mt-0.5 block text-xs leading-snug text-ink-soft">
                        {n.body}
                      </span>
                    )}
                    <span className="mt-1 block text-[11px] text-ink-faint">
                      {fmtRelative(n.created_at)}
                    </span>
                  </span>
                  {!n.read_at && (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
