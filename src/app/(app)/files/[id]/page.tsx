import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FileHeader } from "@/components/files/file-header";
import { ServicesCard } from "@/components/files/services-card";
import { ProfitCard } from "@/components/files/profit-card";
import { PaymentsCard } from "@/components/files/payments-card";
import { TravelersCard } from "@/components/files/travelers-card";
import { NotesCard } from "@/components/files/notes-card";
import { FileTimeline } from "@/components/files/file-timeline";
import type { ServiceImage } from "@/lib/types";
import type {
  ActivityRow,
  FileDetail,
  PaymentRow,
  ServiceRow,
  SupplierOption,
  TravelerRow,
} from "@/components/files/types";

export const metadata = { title: "File" };

const TRAVELER_FIELDS =
  "id, full_name, document_type, document_number, document_expiry, birth_date, linked_contact_id";

/** file_services.images es jsonb: lo leemos defensivamente, nunca confiamos en la forma */
function toServiceImages(value: unknown): ServiceImage[] {
  if (!Array.isArray(value)) return [];
  const out: ServiceImage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { path, name } = item as { path?: unknown; name?: unknown };
    if (typeof path !== "string" || path.length === 0) continue;
    out.push({ path, name: typeof name === "string" && name ? name : "Imagen" });
  }
  return out;
}

export default async function FileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { agency, isAdmin } = await requireMember();
  const supabase = await createClient();

  const { data: fileData } = await supabase
    .from("files")
    .select(
      "*, contact:contacts(id, full_name, phone), seller:members!files_seller_id_fkey(id, display_name), reviewer:members!files_reviewed_by_fkey(id, display_name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!fileData) notFound();

  const [
    totalsRes,
    servicesRes,
    paymentsRes,
    linkedRes,
    contactTravelersRes,
    activitiesRes,
    suppliersRes,
    conversationRes,
    quoteRes,
  ] = await Promise.all([
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
      .select(`traveler:travelers(${TRAVELER_FIELDS})`)
      .eq("file_id", id),
    supabase
      .from("travelers")
      .select(TRAVELER_FIELDS)
      .eq("contact_id", fileData.contact_id)
      .order("created_at", { ascending: true }),
    supabase
      .from("activities")
      .select("id, type, body, created_at, member:members(display_name)")
      .eq("file_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("suppliers")
      .select("id, name, default_commission_pct")
      .eq("is_active", true)
      .order("name"),
    // navegación cruzada: la conversación del contacto (si existe) para el chip "Chat"
    supabase
      .from("conversations")
      .select("id")
      .eq("contact_id", fileData.contact_id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    // navegación cruzada: código del presupuesto de origen (si el file nació de uno)
    fileData.quote_id
      ? supabase.from("quotes").select("id, code").eq("id", fileData.quote_id).maybeSingle()
      : Promise.resolve({ data: null as { id: string; code: string } | null }),
  ]);

  const totals = totalsRes.data;
  const file: FileDetail = {
    id: fileData.id,
    code: fileData.code,
    destination: fileData.destination,
    status: fileData.status,
    review_status: fileData.review_status,
    reviewed_at: fileData.reviewed_at,
    reviewed_by_name: fileData.reviewer?.display_name ?? null,
    currency: fileData.currency,
    departure_date: fileData.departure_date,
    return_date: fileData.return_date,
    notes: fileData.notes,
    commission_type: fileData.commission_type || "utilidad_pct",
    commission_pct: Number(fileData.commission_pct) || 0,
    commission_amount: Number(fileData.commission_amount) || 0,
    commission_label: fileData.commission_label,
    markup: Number(fileData.markup) || 0,
    discount: Number(fileData.discount) || 0,
    created_at: fileData.created_at,
    lead_id: fileData.lead_id,
    quote_id: fileData.quote_id,
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
    deadline_date: s.deadline_date,
    images: toServiceImages(s.images),
    cost: Number(s.cost) || 0,
    price: Number(s.price) || 0,
    gross: s.gross === null ? null : Number(s.gross),
    commission_pct: Number(s.commission_pct) || 0,
    paid_to_supplier: s.paid_to_supplier,
    position: Number(s.position) || 0,
  }));

  /* El bruto y el % del mayorista son plata de la agencia: al vendedor no se le
     muestran y tampoco tienen por qué viajar en el payload del componente cliente. */
  const visibleServices: ServiceRow[] = isAdmin
    ? services
    : services.map((s) => ({ ...s, gross: null, commission_pct: 0 }));

  const suppliers: SupplierOption[] = (suppliersRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    // el % que devuelve cada mayorista también es plata de la agencia
    default_commission_pct: isAdmin ? Number(s.default_commission_pct) || 0 : 0,
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
        services={visibleServices}
        travelers={linkedTravelers}
        agencyName={agency.name}
        quoteCode={quoteRes.data?.code ?? null}
        conversationId={conversationRes.data?.id ?? null}
        isAdmin={isAdmin}
      />

      <div className="flex flex-col gap-4 px-4 pb-4 pt-4 md:px-6 lg:grid lg:grid-cols-[3fr_2fr] lg:items-start">
        {/* columna izquierda (desktop) */}
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          <ServicesCard
            fileId={file.id}
            agencyId={agency.id}
            currency={file.currency}
            services={visibleServices}
            suppliers={suppliers}
            sellerName={file.seller?.display_name ?? "Vendedor"}
            markup={file.markup}
            discount={file.discount}
            commissionType={file.commission_type}
            commissionPct={file.commission_pct}
            commissionAmount={file.commission_amount}
            commissionLabel={file.commission_label}
            isAdmin={isAdmin}
            className="order-1 lg:order-none"
          />
          <TravelersCard
            fileId={file.id}
            linked={linkedTravelers}
            contactTravelers={contactTravelers}
            returnDate={file.return_date}
            className="order-4 lg:order-none"
          />
          <FileTimeline activities={activities} className="order-6 lg:order-none" />
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
            className="order-3 lg:order-none"
          />
          {/* la plata real de la venta: comisión del mayorista + markup − vendedor */}
          {isAdmin && (
            <ProfitCard
              fileId={file.id}
              currency={file.currency}
              sellerName={file.seller?.display_name ?? "Vendedor"}
              services={services}
              markup={file.markup}
              discount={file.discount}
              commissionType={file.commission_type}
              commissionPct={file.commission_pct}
              commissionAmount={file.commission_amount}
              commissionLabel={file.commission_label}
              className="order-2 lg:order-none"
            />
          )}
          <NotesCard fileId={file.id} notes={file.notes} className="order-5 lg:order-none" />
        </div>
      </div>
    </div>
  );
}
