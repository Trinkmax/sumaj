"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/config/confirm-dialog";
import { createTag, deleteTag } from "@/lib/actions/settings";
import { TAG_CATEGORIES, TAG_COLORS } from "@/lib/domain";
import { cn } from "@/lib/utils";

export type TagWithUsage = {
  id: string;
  name: string;
  category: string;
  color: string;
  usage: number;
};

export function TagsManager({ tags }: { tags: TagWithUsage[] }) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<TagWithUsage | null>(null);

  const groups = TAG_CATEGORIES.map((cat) => ({
    ...cat,
    tags: tags.filter((t) => t.category === cat.key),
  })).filter((g) => g.tags.length > 0);

  const uncategorized = tags.filter(
    (t) => !TAG_CATEGORIES.some((c) => c.key === t.category),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          Las etiquetas ordenan a tus contactos: destino, tipo de viaje, temporada…
        </p>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <Plus />
          <span className="hidden sm:inline">Nueva etiqueta</span>
          <span className="sm:hidden">Nueva</span>
        </Button>
      </div>

      {tags.length === 0 ? (
        <EmptyState
          emoji="🏷️"
          title="Todavía no hay etiquetas"
          description="Creá la primera para empezar a organizar tus contactos."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Crear etiqueta
            </Button>
          }
        />
      ) : (
        <div className="space-y-4 animate-slide-up">
          {[...groups, ...(uncategorized.length > 0 ? [{ key: "_otras", label: "Sin categoría", tags: uncategorized }] : [])].map(
            (group) => (
              <section key={group.key} className="card p-5">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  {group.label}
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {group.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className={cn(
                        "group inline-flex items-center gap-1.5 rounded-full border py-1 pl-3 pr-1.5 text-[13px] font-medium leading-5 transition-all",
                        TAG_COLORS[tag.color] ?? TAG_COLORS.gray,
                      )}
                    >
                      {tag.name}
                      <span className="text-[11px] font-normal opacity-70 tabular-nums">
                        {tag.usage}
                      </span>
                      <button
                        onClick={() => setToDelete(tag)}
                        className="rounded-full p-0.5 opacity-50 transition-opacity hover:opacity-100 tap-highlight-none"
                        aria-label={`Eliminar etiqueta ${tag.name}`}
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              </section>
            ),
          )}
        </div>
      )}

      <CreateTagDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`¿Eliminar "${toDelete?.name}"?`}
        description={
          toDelete && toDelete.usage > 0
            ? `Se quita de todos los contactos (la usan ${toDelete.usage}).`
            : "Se quita de todos los contactos."
        }
        onConfirm={async () => {
          if (!toDelete) return;
          const res = await deleteTag({ id: toDelete.id });
          if (!res.ok) {
            toast.error(res.error);
          } else {
            toast.success("Etiqueta eliminada.");
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}

function CreateTagDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState<string>(TAG_CATEGORIES[0].key);
  const [color, setColor] = React.useState("sky");
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await createTag({ name: name.trim(), category, color });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Etiqueta "${name.trim()}" creada.`);
    setName("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent title="Nueva etiqueta" description="Para organizar contactos y leads." size="md">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="tag-name">Nombre *</Label>
            <Input
              id="tag-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Caribe"
              maxLength={40}
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="tag-cat">Categoría</Label>
            <Select id="tag-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {TAG_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(TAG_COLORS).map(([key, classes]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setColor(key)}
                  aria-label={`Color ${key}`}
                  aria-pressed={color === key}
                  className={cn(
                    "size-9 rounded-full border-2 transition-all tap-highlight-none active:scale-95",
                    classes.split(" ")[0], // bg-*
                    color === key
                      ? "border-ink scale-110 shadow-sm"
                      : "border-transparent ring-1 ring-inset ring-ink/10 hover:scale-105",
                  )}
                />
              ))}
            </div>
          </div>
          {name.trim() && (
            <div className="flex items-center gap-2 rounded-xl bg-sand-soft/60 px-3.5 py-2.5">
              <span className="text-xs text-ink-faint">Así se ve:</span>
              <Badge color={color}>{name.trim()}</Badge>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading}>
              Crear etiqueta
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
