import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAnonClient } from "@/lib/supabase/server";
import { QuoteSheet, type QuoteSheetData } from "@/components/quotes/quote-sheet";
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
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-4.5" aria-hidden>
              <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.39a9.87 9.87 0 0 0 4.74 1.21c5.46 0 9.9-4.44 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.32a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.23 8.24Zm4.52-6.16c-.25-.13-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
            </svg>
            Consultar por WhatsApp
          </a>
        </>
      )}
    </div>
  );
}
