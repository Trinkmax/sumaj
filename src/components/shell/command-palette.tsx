"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  SearchX,
  Home,
  KanbanSquare,
  MessagesSquare,
  ReceiptText,
  Users,
  FolderOpen,
  Wallet,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { globalSearch } from "@/lib/actions/search";
import { STAGE_BY_KEY, FILE_STATUSES, QUOTE_STATUSES } from "@/lib/domain";
import { fmtMoney, fmtPhone } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton, EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { LeadStage, FileStatus, QuoteStatus } from "@/lib/types";

/** Resultado de globalSearch (el tipo vive acá: los "use server" solo exportan funciones). */
export type SearchResults = {
  contacts: { id: string; name: string; phone: string | null; isClient: boolean }[];
  leads: {
    id: string;
    contactName: string;
    destination: string | null;
    stage: LeadStage;
  }[];
  files: {
    id: string;
    code: string;
    destination: string;
    contactName: string;
    status: FileStatus;
  }[];
  quotes: {
    id: string;
    code: string;
    destination: string;
    status: QuoteStatus;
    totalPrice: number;
    currency: string;
  }[];
  conversations: { id: string; contactName: string; lastPreview: string | null }[];
};

const OPEN_EVENT = "viajeros:open-search";

/** Abre el buscador global desde cualquier lado (botón de la sidebar, etc.). */
export function openCommandPalette(): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

/* ── accesos rápidos (input vacío) ── */
const QUICK_LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/inicio", label: "Ir a Inicio", icon: Home },
  { href: "/crm", label: "Ir al CRM", icon: KanbanSquare },
  { href: "/crm?vista=chats", label: "Ir a Chats", icon: MessagesSquare },
  { href: "/presupuestos", label: "Ir a Presupuestos", icon: ReceiptText },
  { href: "/clientes", label: "Ir a Clientes", icon: Users },
  { href: "/files", label: "Ir a Files", icon: FolderOpen },
  { href: "/caja", label: "Ir a Caja", icon: Wallet },
  { href: "/presupuestos/nuevo", label: "Nuevo presupuesto", icon: Plus },
];

type FlatItem = { key: string; href: string; node: React.ReactNode };
type Section = { title: string | null; items: FlatItem[] };

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Etiqueta del atajo según plataforma: "⌘K" en Mac/iOS, "Ctrl K" en el resto.
 * Arranca en "⌘K" también en el server y se corrige al montar (sin mismatch
 * de hidratación porque el cambio ocurre en un efecto).
 */
export function useSearchShortcutLabel(): string {
  const [label, setLabel] = React.useState("⌘K");
  React.useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/i.test(
      navigator.platform || navigator.userAgent,
    );
    if (!isMac) setLabel("Ctrl K");
  }, []);
  return label;
}

/**
 * Buscador global ⌘K / Ctrl+K. Se monta UNA vez en el layout y escucha
 * cmd+K / ctrl+K y el CustomEvent "viajeros:open-search".
 */
export function CommandPalette(): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [sel, setSel] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const seqRef = React.useRef(0);

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults(null);
    setLoading(false);
    setSel(0);
  }, []);

  /* atajo global + evento custom */
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => {
          if (o) {
            setQuery("");
            setResults(null);
          }
          return !o;
        });
      }
    }
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
  }, []);

  /* bloquear scroll de fondo + devolver el foco a donde estaba al cerrar */
  React.useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      prevFocus?.focus?.();
    };
  }, [open]);

  /* debounce 250ms → globalSearch */
  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const seq = ++seqRef.current;
    const t = setTimeout(async () => {
      const res = await globalSearch({ q });
      if (seq !== seqRef.current) return; // llegó tarde, ya hay otra búsqueda
      setLoading(false);
      setResults(
        res.ok
          ? res.data
          : { contacts: [], leads: [], files: [], quotes: [], conversations: [] },
      );
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  const navigate = React.useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  /* secciones + lista plana para navegación por teclado */
  const sections = React.useMemo<Section[]>(() => {
    if (!query.trim()) {
      return [
        {
          title: null,
          items: QUICK_LINKS.map((l) => ({
            key: `quick-${l.href}`,
            href: l.href,
            node: (
              <>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sand-soft text-ink-soft">
                  <l.icon className="size-4" />
                </span>
                <span className="flex-1 truncate text-sm font-medium text-ink">
                  {l.label}
                </span>
              </>
            ),
          })),
        },
      ];
    }
    if (!results) return [];
    const out: Section[] = [];

    if (results.contacts.length > 0)
      out.push({
        title: "Clientes",
        items: results.contacts.map((c) => ({
          key: `contact-${c.id}`,
          href: `/clientes/${c.id}`,
          node: (
            <>
              <Avatar name={c.name} className="size-8 text-[11px]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{c.name}</p>
                <p className="truncate text-xs text-ink-faint">{fmtPhone(c.phone)}</p>
              </div>
              {c.isClient && (
                <Chip className="border-tone-emerald-line bg-tone-emerald-soft text-tone-emerald-text">
                  Cliente
                </Chip>
              )}
            </>
          ),
        })),
      });

    if (results.leads.length > 0)
      out.push({
        title: "Leads",
        items: results.leads.map((l) => ({
          key: `lead-${l.id}`,
          href: `/crm/${l.id}`,
          node: (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {l.contactName}
                  {l.destination && (
                    <span className="font-normal text-ink-faint"> · {l.destination}</span>
                  )}
                </p>
              </div>
              <Chip className={STAGE_BY_KEY[l.stage].chip}>
                {STAGE_BY_KEY[l.stage].label}
              </Chip>
            </>
          ),
        })),
      });

    if (results.files.length > 0)
      out.push({
        title: "Files",
        items: results.files.map((f) => ({
          key: `file-${f.id}`,
          href: `/files/${f.id}`,
          node: (
            <>
              <span className="shrink-0 font-mono text-xs font-medium text-ink-soft">
                {f.code}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{f.destination}</p>
                <p className="truncate text-xs text-ink-faint">{f.contactName}</p>
              </div>
              <Chip className={FILE_STATUSES[f.status].chip}>
                {FILE_STATUSES[f.status].label}
              </Chip>
            </>
          ),
        })),
      });

    if (results.quotes.length > 0)
      out.push({
        title: "Presupuestos",
        items: results.quotes.map((q) => ({
          key: `quote-${q.id}`,
          href: `/presupuestos/${q.id}`,
          node: (
            <>
              <span className="shrink-0 font-mono text-xs font-medium text-ink-soft">
                {q.code}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{q.destination}</p>
                <p className="truncate text-xs tabular-nums text-ink-faint">
                  {fmtMoney(q.totalPrice, q.currency)}
                </p>
              </div>
              <Chip className={QUOTE_STATUSES[q.status].chip}>
                {QUOTE_STATUSES[q.status].label}
              </Chip>
            </>
          ),
        })),
      });

    if (results.conversations.length > 0)
      out.push({
        title: "Chats",
        items: results.conversations.map((c) => ({
          key: `conv-${c.id}`,
          href: `/crm?vista=chats&c=${c.id}`,
          node: (
            <>
              <Avatar name={c.contactName} className="size-8 text-[11px]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{c.contactName}</p>
                {c.lastPreview && (
                  <p className="truncate text-xs text-ink-faint">{c.lastPreview}</p>
                )}
              </div>
            </>
          ),
        })),
      });

    return out;
  }, [query, results]);

  const flat = React.useMemo(() => sections.flatMap((s) => s.items), [sections]);

  /* al cambiar los resultados, la selección vuelve arriba */
  React.useEffect(() => {
    setSel(0);
  }, [flat.length, query]);

  /* la fila seleccionada siempre visible */
  React.useEffect(() => {
    if (!open) return;
    document
      .getElementById(`cp-item-${sel}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel, open]);

  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Tab") {
      e.preventDefault();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flat.length > 0) setSel((s) => (s + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length > 0) setSel((s) => (s - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[sel];
      if (item) navigate(item.href);
    }
  }

  if (!open) return <></>;

  const showEmpty =
    !loading && query.trim().length > 0 && results !== null && flat.length === 0;

  let flatIdx = -1;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Buscador">
      {/* overlay */}
      <div
        className="absolute inset-0 bg-overlay backdrop-blur-sm animate-fade-in"
        onMouseDown={close}
      />

      {/* panel */}
      <div
        className="card absolute inset-x-3 top-[10vh] mx-auto max-w-xl overflow-hidden animate-scale-in sm:inset-x-4 sm:top-[15vh]"
        onKeyDown={onPanelKeyDown}
      >
        {/* input */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
          <Search className="size-5 shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar clientes, leads, files, presupuestos…"
            className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
            autoComplete="off"
            spellCheck={false}
            aria-label="Buscar"
          />
          <kbd className="hidden shrink-0 rounded-md border border-line bg-sand-soft px-1.5 py-0.5 text-[10px] font-medium text-ink-faint sm:inline-block">
            Esc
          </kbd>
        </div>

        {/* resultados (el teclado virtual no lo tapa: alto acotado + scroll) */}
        <div className="max-h-[min(55vh,420px)] overflow-y-auto overscroll-contain p-2">
          {loading ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : showEmpty ? (
            <EmptyState
              icon={SearchX}
              title="Nada por acá"
              description="Probá con otro nombre, destino o código."
              className="border-0 py-8"
            />
          ) : (
            sections.map((section) => (
              <div key={section.title ?? "quick"}>
                {section.title && (
                  <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    {section.title}
                  </p>
                )}
                {section.items.map((item) => {
                  flatIdx += 1;
                  const idx = flatIdx;
                  return (
                    <button
                      key={item.key}
                      id={`cp-item-${idx}`}
                      type="button"
                      onClick={() => navigate(item.href)}
                      onMouseMove={() => setSel(idx)}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors tap-highlight-none",
                        idx === sel && "bg-sand-soft",
                      )}
                    >
                      {item.node}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
