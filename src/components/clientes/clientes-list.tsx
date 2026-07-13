"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Tag, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Segmented,
  EmptyState,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Checkbox,
} from "@/components/ui/misc";
import { fmtDate, fmtPhone } from "@/lib/format";
import { TAG_CATEGORIES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { Tables } from "@/lib/types";
import type { ContactRow } from "./types";

type Filter = "todos" | "clientes" | "prospectos";

export function ClientesList({
  contacts,
  allTags,
}: {
  contacts: ContactRow[];
  allTags: Tables<"tags">[];
}) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("todos");
  const [tagIds, setTagIds] = React.useState<string[]>([]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return contacts.filter((c) => {
      if (filter === "clientes" && !c.is_client) return false;
      if (filter === "prospectos" && c.is_client) return false;
      if (tagIds.length > 0 && !c.tags.some((t) => tagIds.includes(t.id))) return false;
      if (!q) return true;
      if (c.full_name.toLowerCase().includes(q)) return true;
      if (c.email?.toLowerCase().includes(q)) return true;
      if (qDigits.length >= 3 && c.phone?.includes(qDigits)) return true;
      return false;
    });
  }, [contacts, query, filter, tagIds]);

  const toggleTag = (id: string) =>
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  const tagsByCategory = React.useMemo(() => {
    return TAG_CATEGORIES.map((cat) => ({
      ...cat,
      tags: allTags.filter((t) => t.category === cat.key),
    })).filter((g) => g.tags.length > 0);
  }, [allTags]);

  if (contacts.length === 0) {
    return (
      <EmptyState
        emoji="🧳"
        title="Todavía no hay contactos"
        description="Cargá el primero con el botón de arriba y empezá a armar tu cartera de clientes."
      />
    );
  }

  return (
    <div className="animate-slide-up space-y-3">
      {/* búsqueda + filtros */}
      <div className="flex flex-col gap-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, teléfono o email…"
            className="pl-10"
            type="search"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "todos", label: "Todos" },
              { value: "clientes", label: "Clientes" },
              { value: "prospectos", label: "Prospectos" },
            ]}
          />

          {tagsByCategory.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary" size="sm" className="rounded-full">
                  <Tag />
                  <span className="hidden sm:inline">Etiquetas</span>
                  {tagIds.length > 0 && (
                    <span className="animate-pop rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold leading-4 text-white">
                      {tagIds.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 max-h-80 overflow-y-auto">
                <div className="space-y-3">
                  {tagsByCategory.map((group) => (
                    <div key={group.key}>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                        {group.label}
                      </p>
                      <div className="space-y-0.5">
                        {group.tags.map((tag) => (
                          <label
                            key={tag.id}
                            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-sand-soft"
                          >
                            <Checkbox
                              checked={tagIds.includes(tag.id)}
                              onCheckedChange={() => toggleTag(tag.id)}
                            />
                            <Badge color={tag.color}>{tag.name}</Badge>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  {tagIds.length > 0 && (
                    <button
                      onClick={() => setTagIds([])}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:bg-sand-soft"
                    >
                      <X className="size-3.5" /> Limpiar filtros
                    </button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {/* resultados */}
      {filtered.length === 0 ? (
        <EmptyState
          emoji="🔍"
          title="No encontramos contactos"
          description="Probá con otro nombre o sacá los filtros."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setQuery("");
                setFilter("todos");
                setTagIds([]);
              }}
            >
              Limpiar búsqueda
            </Button>
          }
        />
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {filtered.map((c) => (
            <ContactRowItem key={c.id} contact={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContactRowItem({ contact: c }: { contact: ContactRow }) {
  const meta = [c.phone ? fmtPhone(c.phone) : null, c.city].filter(Boolean).join(" · ");

  return (
    <Link
      href={`/clientes/${c.id}`}
      className={cn(
        "flex min-h-14 items-center gap-3 px-3.5 py-2.5 transition-colors tap-highlight-none",
        "hover:bg-sand-soft/60 active:bg-sand-soft",
      )}
    >
      <Avatar name={c.full_name} className="size-10" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-ink">{c.full_name}</p>
          {c.is_client && (
            <Badge className="shrink-0 border-money-100 bg-money-50 text-money-700">
              Cliente
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden">
          {meta && <p className="shrink-0 truncate text-[13px] text-ink-faint">{meta}</p>}
          {c.tags.length > 0 && (
            <span className="hidden items-center gap-1 overflow-hidden sm:flex">
              {c.tags.slice(0, 3).map((t) => (
                <Badge key={t.id} color={t.color} className="shrink-0">
                  {t.name}
                </Badge>
              ))}
              {c.tags.length > 3 && (
                <span className="shrink-0 text-[11px] text-ink-faint">+{c.tags.length - 3}</span>
              )}
            </span>
          )}
        </div>
      </div>

      <span className="shrink-0 text-xs tabular-nums text-ink-faint">{fmtDate(c.created_at)}</span>
    </Link>
  );
}
