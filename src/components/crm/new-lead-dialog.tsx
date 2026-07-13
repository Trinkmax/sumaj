"use client";

import * as React from "react";
import { toast } from "sonner";
import { UserRound } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { CHANNELS } from "@/lib/domain";
import { normalizePhone } from "@/lib/format";
import { createLead, findContactByPhone } from "@/lib/actions/leads";
import type { LeadChannel } from "@/lib/types";
import type { BoardLead, MemberOption } from "./types";

/**
 * Alta de lead en menos de 30 segundos: solo el nombre es obligatorio.
 */
export function NewLeadDialog({
  open,
  onOpenChange,
  members,
  meId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: MemberOption[];
  meId: string;
  onCreated?: (lead: BoardLead) => void;
}) {
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [channel, setChannel] = React.useState<LeadChannel>("whatsapp");
  const [assignedTo, setAssignedTo] = React.useState(meId);
  const [notes, setNotes] = React.useState("");
  const [existing, setExisting] = React.useState<{ id: string; full_name: string } | null>(null);
  const [loading, setLoading] = React.useState(false);

  // reset del formulario al abrir (ajuste de estado durante el render)
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setName("");
      setPhone("");
      setDestination("");
      setChannel("whatsapp");
      setAssignedTo(meId);
      setNotes("");
      setExisting(null);
    }
  }

  async function checkPhone() {
    const normalized = phone.trim() ? normalizePhone(phone) : "";
    if (normalized.length < 8) {
      setExisting(null);
      return;
    }
    const res = await findContactByPhone({ phone: normalized });
    if (res.ok) {
      setExisting(res.data);
      if (res.data && !name.trim()) setName(res.data.full_name);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      toast.error("Poné al menos el nombre.");
      return;
    }
    setLoading(true);
    const res = await createLead({
      fullName: name.trim(),
      phone: phone.trim() || null,
      destination: destination.trim() || null,
      channel,
      assignedTo: assignedTo || null,
      initialMessage: notes.trim() || null,
    });
    setLoading(false);

    if (!res.ok) {
      toast.error(res.error);
      return;
    }

    const assignee = members.find((m) => m.id === assignedTo) ?? null;
    onCreated?.({
      id: res.data.leadId,
      stage: "nuevo",
      position: res.data.position,
      destination: destination.trim() || null,
      origin_channel: channel,
      origin_campaign: null,
      next_action_at: null,
      created_at: new Date().toISOString(),
      pax_adults: 1,
      pax_children: 0,
      assigned_to: assignedTo || null,
      won_file_id: null,
      contact: {
        id: res.data.contactId,
        full_name: existing?.full_name ?? name.trim(),
        phone: phone.trim() ? normalizePhone(phone) : null,
      },
      assignee: assignee ? { id: assignee.id, display_name: assignee.display_name } : null,
      conversation: null,
      _new: true,
    });

    toast.success(
      res.data.existingContact
        ? `Nueva consulta creada para ${existing?.full_name ?? name.trim()} ✨`
        : "Lead creado ✨",
    );
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Nuevo lead"
        description="Solo el nombre es obligatorio. Lo demás se completa después."
      >
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="nl-name">Nombre *</Label>
            <Input
              id="nl-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Carla Domínguez"
              maxLength={120}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="nl-phone">Teléfono</Label>
              <Input
                id="nl-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setExisting(null);
                }}
                onBlur={checkPhone}
                placeholder="351 555 0000"
              />
              {existing && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-brand-700 animate-fade-in">
                  <UserRound className="size-3.5 shrink-0" />
                  Ya existe {existing.full_name} — se le va a crear una nueva consulta.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="nl-dest">Destino</Label>
              <Input
                id="nl-dest"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Ej: Cancún"
                maxLength={120}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="nl-channel">Canal</Label>
              <Select
                id="nl-channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value as LeadChannel)}
              >
                {Object.entries(CHANNELS).map(([key, c]) => (
                  <option key={key} value={key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="nl-assignee">Asignar a</Label>
              <Select
                id="nl-assignee"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                    {m.id === meId ? " (yo)" : ""}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="nl-notes">Notas / mensaje inicial</Label>
            <Textarea
              id="nl-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: quiere viajar en enero con los chicos…"
              className="min-h-[72px]"
              maxLength={2000}
            />
          </div>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={loading}>
              Crear lead
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
