"use client";

import * as React from "react";
import { toast } from "sonner";
import { Pencil, Check, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateMyProfile } from "@/lib/actions/settings";

const ROLE_LABELS: Record<string, string> = {
  admin: "Socio/Admin",
  vendedor: "Vendedor",
  freelance: "Freelance",
};

export function ProfileCard({
  displayName,
  email,
  role,
}: {
  displayName: string;
  email: string | null;
  role: string;
}) {
  const [name, setName] = React.useState(displayName);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(displayName);
  const [saving, setSaving] = React.useState(false);

  async function save() {
    const next = draft.trim();
    if (next.length < 2) {
      toast.error("Poné un nombre válido (mínimo 2 letras).");
      return;
    }
    if (next === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const prev = name;
    setName(next); // optimista
    const res = await updateMyProfile({ display_name: next });
    setSaving(false);
    if (!res.ok) {
      setName(prev);
      toast.error(res.error);
      return;
    }
    setEditing(false);
    toast.success("Listo, actualizamos tu nombre.");
  }

  return (
    <div className="card p-5 animate-slide-up">
      <div className="flex items-center gap-4">
        <Avatar name={name} className="size-14 text-base" />
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") setEditing(false);
                }}
                autoFocus
                maxLength={80}
                className="h-9 max-w-xs"
                aria-label="Tu nombre"
              />
              <Button size="icon-sm" variant="primary" onClick={save} loading={saving} aria-label="Guardar nombre">
                {!saving && <Check />}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  setDraft(name);
                  setEditing(false);
                }}
                aria-label="Cancelar"
              >
                <X />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="truncate font-display text-lg font-semibold text-ink">{name}</p>
              <button
                onClick={() => {
                  setDraft(name);
                  setEditing(true);
                }}
                className="rounded-full p-1.5 text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
                aria-label="Editar tu nombre"
              >
                <Pencil className="size-3.5" />
              </button>
            </div>
          )}
          <p className="mt-0.5 truncate text-sm text-ink-soft">{email ?? "Sin email"}</p>
        </div>
        <Badge className="shrink-0">{ROLE_LABELS[role] ?? role}</Badge>
      </div>
    </div>
  );
}
