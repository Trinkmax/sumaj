import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAnonClient } from "@/lib/supabase/server";
import { QuoteSheet, type QuoteSheetData } from "@/components/quotes/quote-sheet";
import { WhatsAppIcon } from "@/components/quotes/wa-icon";
import { waLink } from "@/lib/domain";
import type { ServiceType } from "@/lib/types";

type QuotePublic = {
  code: string;
  title: string | null;
  destination: string;
  currency: string;
  pax: number;
  nights: number | null;
  trip_date_from: string | null;
  trip_date_to: string | null;
  valid_until: string | null;
  status: string;
  total_price: number;
  per_person: number;
  discount: number;
  notes: string | null;
  theme: { color?: string; font?: string } | null;
  created_at: string;
  contact_name: string | null;
  contact_phone: string | null;
  agency: { name: string; logo_url: string | null; phone: string | null; email: string | null };
  seller_name: string | null;
  items: { type: ServiceType; description: string }[];
};

// cache(): un solo fetch por request compartido entre generateMetadata y la página
const fetchQuote = cache(async (token: string): Promise<QuotePublic | null> => {
  const supabase = createAnonClient();
  const { data } = await supabase.rpc("quote_public", { token });
  return (data as QuotePublic | null) ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const quote = await fetchQuote(token);
  if (!quote) return { title: "Presupuesto" };

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return {
    title: `Presupuesto ${quote.destination} — ${quote.agency.name}`,
    description: `Tu viaje a ${quote.destination}, cotizado por ${quote.agency.name}.`,
    openGraph: {
      title: `Presupuesto ${quote.destination} — ${quote.agency.name}`,
      images: [
        {
          url: `${base}/api/public/quote-image/${token}`,
          width: 800,
          height: 1130,
        },
      ],
    },
  };
}

export default async function PresupuestoPublicoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const quote = await fetchQuote(token);
  if (!quote) notFound();

  const data: QuoteSheetData = {
    code: quote.code,
    title: quote.title,
    destination: quote.destination,
    currency: quote.currency,
    pax: quote.pax,
    nights: quote.nights,
    tripDateFrom: quote.trip_date_from,
    tripDateTo: quote.trip_date_to,
    validUntil: quote.valid_until,
    totalPrice: Number(quote.total_price),
    perPerson: Number(quote.per_person),
    discount: Number(quote.discount),
    notes: quote.notes,
    createdAt: quote.created_at,
    contactName: quote.contact_name,
    contactPhone: quote.contact_phone,
    agencyName: quote.agency.name,
    agencyLogoUrl: quote.agency.logo_url,
    agencyPhone: quote.agency.phone,
    sellerName: quote.seller_name,
    items: quote.items,
    theme: quote.theme ?? {},
  };

  return (
    <div className="min-h-dvh w-full px-4 py-8 sm:py-14" style={{ backgroundColor: "#efece6" }}>
      <div className="animate-slide-up-slow">
        <QuoteSheet data={data} />
      </div>

      {quote.agency.phone && (
        <>
          {/* espacio para que el botón flotante no tape el pie */}
          <div className="h-20" />
          <a
            href={waLink(quote.agency.phone, `Hola! Vi el presupuesto ${quote.code} ✈️`)}
            target="_blank"
            rel="noopener noreferrer"
            className="fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-[#25d366] px-5 py-3 text-sm font-medium text-white shadow-lg shadow-[#25d366]/30 transition-all tap-highlight-none hover:bg-[#1fb958] hover:shadow-xl active:scale-[0.97]"
          >
            <WhatsAppIcon className="size-4.5" />
            Consultar por WhatsApp
          </a>
        </>
      )}
    </div>
  );
}
