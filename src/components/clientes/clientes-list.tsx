"use client";

import * as React from "react";
import Link from "next/link";
import { BadgeCheck, ChevronRight, Luggage, Search, SearchX, Tag, X } from "lucide-react";
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
  Tooltip,
} from "@/components/ui/misc";
import { fmtPhone, fmtRelative } from "@/lib/format";
import { TAG_CATEGORIES, TAG_DOTS } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { Tables } from "@/lib/types";
import { NewContactButton } from "./new-contact-dialog";
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
      if (c.city?.toLowerCase().includes(q)) return true;
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
        icon={Luggage}
        title="Todavía no hay contactos"
        description="Cargá el primero y empezá a armar tu cartera de clientes."
        action={<NewContactButton contacts={[]} />}
      />
    );
  }

  return (
    <div className="animate-slide-up space-y-3">
      {/* búsqueda prominente + filtros */}
      <div className="flex flex-col gap-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, teléfono, email o ciudad…"
            className="h-11 pl-11 text-[15px]"
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
              <PopoverContent align="end" className="max-h-80 w-64 overflow-y-auto">
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
                            <span
                              className={cn(
                                "size-2.5 shrink-0 rounded-full",
                                TAG_DOTS[tag.color] ?? TAG_DOTS.gray,
                              )}
                              aria-hidden
                            />
                            <span className="text-[13px] text-ink">{tag.name}</span>
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
          icon={SearchX}
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
        <div
          className={cn(
            "card divide-y divide-line overflow-hidden",
            filtered.length <= 14 ? "stagger-children" : "animate-slide-up",
          )}
        >
          {filtered.map((c) => (
            <ContactRowItem key={c.id} contact={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContactRowItem({ contact: c }: { contact: ContactRow }) {
  const meta = [c.city, c.phone ? fmtPhone(c.phone) : null].filter(Boolean).join(" · ");

  return (
    <Link
      href={`/clientes/${c.id}`}
      className={cn(
        "group flex min-h-16 items-center gap-3 px-3.5 py-2.5 transition-colors tap-highlight-none",
        "hover:bg-sand-soft/60 active:bg-sand-soft",
      )}
    >
      <Avatar
        name={c.full_name}
        className="size-11 text-sm transition-transform duration-200 group-hover:scale-105"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-ink">{c.full_name}</p>
          {c.is_client ? (
            <Badge className="shrink-0 border-tone-emerald-line bg-tone-emerald-soft text-tone-emerald-text">
              <BadgeCheck className="size-3" /> Cliente
            </Badge>
          ) : (
            <Badge className="shrink-0">Contacto</Badge>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 overflow-hidden">
          {meta ? (
            <p className="truncate text-[13px] text-ink-faint">{meta}</p>
          ) : (
            <p className="truncate text-[13px] text-ink-faint">Sin teléfono todavía</p>
          )}
          {c.tags.length > 0 && (
            <span className="flex shrink-0 items-center gap-1">
              {c.tags.slice(0, 4).map((t) => (
                <Tooltip key={t.id} content={t.name}>
                  <span
                    className={cn(
                      "size-2 rounded-full ring-2 ring-paper",
                      TAG_DOTS[t.color] ?? TAG_DOTS.gray,
                    )}
                  />
                </Tooltip>
              ))}
              {c.tags.length > 4 && (
                <span className="text-[11px] text-ink-faint">+{c.tags.length - 4}</span>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {c.last_activity_at && (
          <span className="text-xs tabular-nums text-ink-faint">
            {fmtRelative(c.last_activity_at)}
          </span>
        )}
        <ChevronRight className="size-4 text-ink-faint/60 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink-faint" />
      </div>
    </Link>
  );
}
