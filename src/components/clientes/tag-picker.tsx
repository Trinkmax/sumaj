"use client";

import * as React from "react";
import { Plus, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/misc";
import { TAG_CATEGORIES, TAG_COLORS } from "@/lib/domain";
import { cn } from "@/lib/utils";
import {
  addContactTag,
  removeContactTag,
  createTagForContact,
} from "@/lib/actions/contacts";
import type { Tables } from "@/lib/types";

const COLOR_KEYS = Object.keys(TAG_COLORS);

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return COLOR_KEYS[h % COLOR_KEYS.length];
}

/**
 * Chips de etiquetas del contacto + popover para agregar/quitar/crear.
 * Optimista: el chip aparece/desaparece al instante, se revierte si falla.
 */
export function TagPicker({
  contactId,
  allTags,
  assigned,
}: {
  contactId: string;
  allTags: Tables<"tags">[];
  assigned: Tables<"tags">[];
}) {
  const [tags, setTags] = React.useState<Tables<"tags">[]>(assigned);
  const [available, setAvailable] = React.useState<Tables<"tags">[]>(allTags);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newCategory, setNewCategory] = React.useState<string>(TAG_CATEGORIES[0].key);
  const [showCreate, setShowCreate] = React.useState(false);

  React.useEffect(() => setTags(assigned), [assigned]);
  React.useEffect(() => setAvailable(allTags), [allTags]);

  const assignedIds = new Set(tags.map((t) => t.id));

  const toggle = async (tag: Tables<"tags">) => {
    const has = assignedIds.has(tag.id);
    // optimista
    setTags((prev) => (has ? prev.filter((t) => t.id !== tag.id) : [...prev, tag]));
    const res = has
      ? await removeContactTag({ contactId, tagId: tag.id })
      : await addContactTag({ contactId, tagId: tag.id });
    if (!res.ok) {
      // revertir
      setTags((prev) => (has ? [...prev, tag] : prev.filter((t) => t.id !== tag.id)));
      toast.error(res.error);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    const res = await createTagForContact({
      contactId,
      name,
      category: newCategory,
      color: colorFor(name),
    });
    setCreating(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setAvailable((prev) => [...prev, res.data.tag]);
    setTags((prev) => [...prev, res.data.tag]);
    setNewName("");
    setShowCreate(false);
    toast.success("Etiqueta creada.");
  };

  const byCategory = TAG_CATEGORIES.map((cat) => ({
    ...cat,
    tags: available.filter((t) => t.category === cat.key),
  })).filter((g) => g.tags.length > 0);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <Badge key={t.id} color={t.color} className="animate-pop">
          {t.name}
          <button
            onClick={() => toggle(t)}
            className="-mr-0.5 rounded-full p-0.5 opacity-50 transition-opacity hover:opacity-100 tap-highlight-none"
            aria-label={`Quitar etiqueta ${t.name}`}
          >
            <X className="size-2.5" />
          </button>
        </Badge>
      ))}

      <Popover>
        <PopoverTrigger asChild>
          <button
            className="inline-flex h-[22px] items-center gap-1 rounded-full border border-dashed border-line-strong px-2 text-[11px] font-medium text-ink-faint transition-colors hover:border-ink-faint hover:text-ink-soft tap-highlight-none"
            aria-label="Agregar etiqueta"
          >
            <Plus className="size-3" /> Etiqueta
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 max-h-80 overflow-y-auto">
          <div className="space-y-3">
            {byCategory.map((group) => (
              <div key={group.key}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {group.tags.map((tag) => {
                    const active = assignedIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => toggle(tag)}
                        className={cn(
                          "rounded-full transition-all tap-highlight-none active:scale-95",
                          !active && "opacity-60 hover:opacity-100",
                        )}
                      >
                        <Badge color={tag.color}>
                          {active && <Check className="size-2.5" />}
                          {tag.name}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {byCategory.length === 0 && !showCreate && (
              <p className="py-1 text-center text-[13px] text-ink-faint">
                Todavía no hay etiquetas. Creá la primera.
              </p>
            )}

            {showCreate ? (
              <form onSubmit={create} className="space-y-2 border-t border-line pt-2.5">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nombre de la etiqueta"
                  className="h-9"
                  autoFocus
                />
                <Select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="h-9"
                >
                  {TAG_CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                <div className="flex justify-end gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCreate(false)}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" size="sm" loading={creating}>
                    Crear
                  </Button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setShowCreate(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border-t border-line py-2 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink tap-highlight-none"
              >
                <Plus className="size-3.5" /> Nueva etiqueta
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
