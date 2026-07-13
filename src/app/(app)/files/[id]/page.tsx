import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FileHeader } from "@/components/files/file-header";
import { ServicesCard } from "@/components/files/services-card";
import { PaymentsCard } from "@/components/files/payments-card";
import { TravelersCard } from "@/components/files/travelers-card";
import { NotesCard } from "@/components/files/notes-card";
import { FileTimeline } from "@/components/files/file-timeline";
import type {
  ActivityRow,
  FileDetail,
  PaymentRow,
  ServiceRow,
  TravelerRow,
} from "@/components/files/types";

export const metadata = { title: "File" };

export default async function FileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { agency } = await requireMember();
  const supabase = await createClient();

  const { data: fileData } = await supabase
    .from("files")
    .select(
      "*, contact:contacts(id, full_name, phone), seller:members(id, display_name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!fileData) notFound();

  const [totalsRes, servicesRes, paymentsRes, linkedRes, contactTravelersRes, activitiesRes, suppliersRes] =
    await Promise.all([
      supabase
        .from("file_totals")
        .select("total_cost, total_sale, utility, paid_total, balance")
        .eq("file_id", id)
        .maybeSingle(),
      supabase
        .from("file_services")
        .select("*, supplier:suppliers(id, name)")
        .eq("file_id", id)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("payments")
        .select(
          "id, paid_at, method, amount, currency, amount_in_file_currency, receipt_code, receipt_token, note",
        )
        .eq("file_id", id)
        .eq("direction", "cobro")
        .order("paid_at", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("file_travelers")
        .select("traveler:travelers(id, full_name, document_type, document_number, document_expiry, birth_date)")
        .eq("file_id", id),
      supabase
        .from("travelers")
        .select("id, full_name, document_type, document_number, document_expiry, birth_date")
        .eq("contact_id", fileData.contact_id)
        .order("created_at", { ascending: true }),
      supabase
        .from("activities")
        .select("id, type, body, created_at, member:members(display_name)")
        .eq("file_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("suppliers").select("id, name").eq("is_active", true).order("name"),
    ]);

  const totals = totalsRes.data;
  const file: FileDetail = {
    id: fileData.id,
    code: fileData.code,
    destination: fileData.destination,
    status: fileData.status,
    currency: fileData.currency,
    departure_date: fileData.departure_date,
    return_date: fileData.return_date,
    notes: fileData.notes,
    commission_pct: Number(fileData.commission_pct) || 0,
    created_at: fileData.created_at,
    contact: fileData.contact,
    seller: fileData.seller,
    totals: {
      total_cost: Number(totals?.total_cost) || 0,
      total_sale: Number(totals?.total_sale) || 0,
      utility: Number(totals?.utility) || 0,
      paid_total: Number(totals?.paid_total) || 0,
      balance: Number(totals?.balance) || 0,
    },
  };

  const services: ServiceRow[] = (servicesRes.data ?? []).map((s) => ({
    id: s.id,
    type: s.type,
    description: s.description,
    supplier_id: s.supplier_id,
    supplier_name: s.supplier?.name ?? null,
    reservation_code: s.reservation_code,
    date_from: s.date_from,
    date_to: s.date_to,
    cost: Number(s.cost) || 0,
    price: Number(s.price) || 0,
    paid_to_supplier: s.paid_to_supplier,
    position: Number(s.position) || 0,
  }));

  const payments: PaymentRow[] = (paymentsRes.data ?? []).map((p) => ({
    ...p,
    amount: Number(p.amount) || 0,
    amount_in_file_currency: Number(p.amount_in_file_currency) || 0,
  }));

  const linkedTravelers: TravelerRow[] = (linkedRes.data ?? [])
    .map((row) => row.traveler)
    .filter((t): t is NonNullable<typeof t> => t != null);

  const contactTravelers: TravelerRow[] = contactTravelersRes.data ?? [];

  const activities: ActivityRow[] = (activitiesRes.data ?? []).map((a) => ({
    id: a.id,
    type: a.type,
    body: a.body,
    created_at: a.created_at,
    member_name: a.member?.display_name ?? null,
  }));

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <Link
          href="/files"
          className="inline-flex min-h-8 items-center gap-1.5 text-sm text-ink-faint transition-colors hover:text-ink tap-highlight-none"
        >
          <ArrowLeft className="size-4" /> Files
        </Link>
      </div>

      <FileHeader
        file={file}
        services={services}
        travelers={linkedTravelers}
        agencyName={agency.name}
      />

      <div className="flex flex-col gap-4 px-4 pb-4 pt-4 md:px-6 lg:grid lg:grid-cols-[3fr_2fr] lg:items-start">
        {/* columna izquierda (desktop) */}
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          <ServicesCard
            fileId={file.id}
            currency={file.currency}
            services={services}
            suppliers={suppliersRes.data ?? []}
            sellerName={file.seller?.display_name ?? "Vendedor"}
            commissionPct={file.commission_pct}
            className="order-1 lg:order-none"
          />
          <TravelersCard
            fileId={file.id}
            linked={linkedTravelers}
            contactTravelers={contactTravelers}
            returnDate={file.return_date}
            className="order-3 lg:order-none"
          />
          <FileTimeline activities={activities} className="order-5 lg:order-none" />
        </div>

        {/* columna derecha (desktop) */}
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          <PaymentsCard
            file={{
              id: file.id,
              code: file.code,
              currency: file.currency,
              contact_id: file.contact?.id ?? null,
              contact_name: file.contact?.full_name ?? "—",
              balance: file.totals.balance,
            }}
            contactPhone={file.contact?.phone ?? null}
            totals={file.totals}
            payments={payments}
            className="order-2 lg:order-none"
          />
          <NotesCard fileId={file.id} notes={file.notes} className="order-4 lg:order-none" />
        </div>
      </div>
    </div>
  );
}
