import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LeadDetail } from "@/components/crm/lead-detail";
import type {
  DetailLead,
  LeadActivity,
  LeadQuote,
  MemberOption,
  TagOption,
} from "@/components/crm/types";

export const metadata = { title: "Lead" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const { member, isStaff } = await requireMember();
  const supabase = await createClient();

  const [leadRes, activitiesRes, quotesRes, membersRes, tagsRes] = await Promise.all([
    supabase
      .from("leads")
      .select(
        `id, stage, destination, trip_date_from, trip_date_to, pax_adults, pax_children,
         trip_type, budget_estimate, budget_currency, next_action, next_action_at,
         origin_channel, origin_campaign, initial_message, lost_reason, assigned_to,
         created_at, won_file_id,
         contact:contacts(id, full_name, phone, email, contact_tags(tag:tags(id, name, color, category))),
         won_file:files!leads_won_file_fk(id, code)`,
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("activities")
      .select("id, type, body, created_at, member:members(display_name)")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("quotes")
      .select("id, code, total_price, currency, status, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("members")
      .select("id, display_name, role")
      .eq("is_active", true)
      .order("display_name"),
    supabase.from("tags").select("id, name, color, category").order("name"),
  ]);

  const raw = leadRes.data;
  if (!raw || !raw.contact) notFound();

  const lead: DetailLead = {
    id: raw.id,
    stage: raw.stage,
    destination: raw.destination,
    trip_date_from: raw.trip_date_from,
    trip_date_to: raw.trip_date_to,
    pax_adults: raw.pax_adults,
    pax_children: raw.pax_children,
    trip_type: raw.trip_type,
    budget_estimate: raw.budget_estimate != null ? Number(raw.budget_estimate) : null,
    budget_currency: raw.budget_currency,
    next_action: raw.next_action,
    next_action_at: raw.next_action_at,
    origin_channel: raw.origin_channel,
    origin_campaign: raw.origin_campaign,
    initial_message: raw.initial_message,
    lost_reason: raw.lost_reason,
    assigned_to: raw.assigned_to,
    created_at: raw.created_at,
    won_file_id: raw.won_file_id,
    contact: {
      id: raw.contact.id,
      full_name: raw.contact.full_name,
      phone: raw.contact.phone,
      email: raw.contact.email,
    },
    tags: (raw.contact.contact_tags ?? [])
      .map((ct) => ct.tag)
      .filter((t): t is TagOption => t != null),
    wonFile: raw.won_file ?? null,
  };

  const activities: LeadActivity[] = (activitiesRes.data ?? []).map((a) => ({
    id: a.id,
    type: a.type,
    body: a.body,
    created_at: a.created_at,
    author: a.member?.display_name ?? null,
  }));

  const quotes: LeadQuote[] = (quotesRes.data ?? []).map((q) => ({
    id: q.id,
    code: q.code,
    total_price: Number(q.total_price),
    currency: q.currency,
    status: q.status,
    created_at: q.created_at,
  }));

  const members: MemberOption[] = membersRes.data ?? [];
  const allTags: TagOption[] = tagsRes.data ?? [];

  return (
    <LeadDetail
      lead={lead}
      quotes={quotes}
      activities={activities}
      members={members}
      allTags={allTags}
      me={{ id: member.id, name: member.display_name, isStaff }}
    />
  );
}
