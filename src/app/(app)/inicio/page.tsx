import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CHANNELS, STAGES, waLink } from "@/lib/domain";
import { fmtDate } from "@/lib/format";
import type { LeadChannel, LeadStage } from "@/lib/types";
import { consejoDelDia } from "@/components/inicio/consejos";
import { TodaySection, type AgendaItem } from "@/components/inicio/today-section";
import { KpiBand, type MonthStats } from "@/components/inicio/kpi-band";
import { InsightsCard, type ChartPoint } from "@/components/inicio/insights-card";
import { SellerRanking, type RankingRow } from "@/components/inicio/seller-ranking";
import type { MoneyByCurrency } from "@/components/inicio/money-multi";
import { CampaignTable, type CampaignRow } from "@/components/inicio/campaign-table";
import {
  RadarSection,
  type BirthdayItem,
  type DepartureItem,
  type DocumentItem,
} from "@/components/inicio/radar-section";

export const metadata = { title: "Inicio" };

const ACTIVE_STAGES: LeadStage[] = ["nuevo", "contactado", "presupuestado", "negociacion"];

const DOC_LABELS: Record<string, string> = {
  dni: "DNI",
  pasaporte: "Pasaporte",
  visa: "Visa",
  otro: "Documento",
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export default async function InicioPage() {
  const { member, agency, isAdmin } = await requireMember();
  const supabase = await createClient();
  const mineOnly = !isAdmin;

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const todayYmd = ymd(now);
  const startMonthYmd = ymd(startMonth);
  const startNextMonthYmd = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const in30 = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30));
  const in90 = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 90));
  const back180 = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 180));

  /* ── queries (todas en paralelo) ── */
  let newLeadsQ = supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("stage", "nuevo");
  if (mineOnly) newLeadsQ = newLeadsQ.or(`assigned_to.is.null,assigned_to.eq.${member.id}`);

  let agendaQ = supabase
    .from("leads")
    .select("id, destination, next_action, next_action_at, contact:contacts(full_name)", {
      count: "exact",
    })
    .not("next_action_at", "is", null)
    .lte("next_action_at", endToday.toISOString())
    .in("stage", ACTIVE_STAGES)
    .order("next_action_at", { ascending: true })
    .limit(5);
  if (mineOnly) agendaQ = agendaQ.eq("assigned_to", member.id);

  // vencidos reales (count exacto, no la muestra de 5 de la agenda)
  let overdueQ = supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .not("next_action_at", "is", null)
    .lt("next_action_at", now.toISOString())
    .in("stage", ACTIVE_STAGES);
  if (mineOnly) overdueQ = overdueQ.eq("assigned_to", member.id);

  let funnelQ = supabase.from("leads").select("stage").in("stage", ACTIVE_STAGES);
  if (mineOnly) funnelQ = funnelQ.or(`assigned_to.is.null,assigned_to.eq.${member.id}`);

  const [
    newLeadsRes,
    agendaRes,
    overdueRes,
    unreadRes,
    filesRes,
    totalsRes,
    membersRes,
    pautaRes,
    funnelRes,
    departuresRes,
    docsRes,
    birthdaysRes,
    cobrosRes,
  ] = await Promise.all([
    newLeadsQ,
    agendaQ,
    overdueQ,
    supabase.from("conversations").select("unread_count").gt("unread_count", 0),
    supabase
      .from("files")
      .select("id, created_at, seller_id, status, currency")
      .neq("status", "cancelado"),
    supabase.from("file_totals").select("file_id, total_sale, utility, paid_total, balance"),
    supabase.from("members").select("id, display_name, avatar_url").eq("is_active", true),
    supabase
      .from("leads")
      .select("stage, origin_campaign, origin_channel")
      .gte("created_at", startMonth.toISOString()),
    funnelQ,
    supabase
      .from("files")
      .select("id, destination, departure_date, currency, contact:contacts(full_name)")
      .neq("status", "cancelado")
      .gte("departure_date", todayYmd)
      .lte("departure_date", in30)
      .order("departure_date", { ascending: true })
      .limit(4),
    supabase
      .from("travelers")
      .select("id, full_name, document_type, document_expiry, contact_id")
      .not("document_expiry", "is", null)
      .gte("document_expiry", back180)
      .lte("document_expiry", in90)
      .order("document_expiry", { ascending: true })
      .limit(4),
    supabase
      .from("contacts")
      .select("id, full_name, birth_date, phone")
      .not("birth_date", "is", null),
    supabase
      .from("payments")
      .select("amount_in_file_currency, file:files(seller_id, currency, status)")
      .eq("direction", "cobro")
      .gte("paid_at", startMonthYmd)
      .lt("paid_at", startNextMonthYmd),
  ]);

  /* ── PARA HOY ── */
  const newLeads = newLeadsRes.count ?? 0;
  const followupsCount = agendaRes.count ?? 0;
  const agenda: AgendaItem[] = (agendaRes.data ?? []).map((l) => ({
    id: l.id,
    contactName: l.contact?.full_name ?? "Sin nombre",
    destination: l.destination,
    nextAction: l.next_action,
    nextActionAt: l.next_action_at as string,
  }));
  const overdueCount = overdueRes.count ?? 0;
  const unread = (unreadRes.data ?? []).reduce((acc, c) => acc + (c.unread_count ?? 0), 0);

  /* ── EL MES ── */
  type FileRow = {
    id: string;
    created_at: string;
    seller_id: string | null;
    status: string;
    currency: string;
  };
  const files: FileRow[] = filesRes.data ?? [];
  const totalsMap = new Map(
    (totalsRes.data ?? []).map((t) => [
      t.file_id as string,
      {
        sale: Number(t.total_sale ?? 0),
        utility: Number(t.utility ?? 0),
        paid: Number(t.paid_total ?? 0),
        balance: Number(t.balance ?? 0),
      },
    ]),
  );
  const saleOf = (f: FileRow) => totalsMap.get(f.id)?.sale ?? 0;
  const addMoney = (m: MoneyByCurrency, currency: string, amount: number) => {
    m[currency] = (m[currency] ?? 0) + amount;
  };

  const monthFilesAll = files.filter((f) => new Date(f.created_at) >= startMonth);
  const currency =
    monthFilesAll.map((f) => f.currency).sort(
      (a, b) =>
        monthFilesAll.filter((f) => f.currency === b).length -
        monthFilesAll.filter((f) => f.currency === a).length,
    )[0] ??
    files[0]?.currency ??
    "USD";

  // cobros del mes (por paid_at, normalizados a la moneda del file)
  type CobroRow = { amount: number; sellerId: string | null; currency: string };
  const monthCobros: CobroRow[] = (cobrosRes.data ?? [])
    .filter((p) => p.file && p.file.status !== "cancelado")
    .map((p) => ({
      amount: Number(p.amount_in_file_currency ?? 0),
      sellerId: p.file!.seller_id,
      currency: p.file!.currency,
    }));

  const buildStats = (sellerId: string | null): MonthStats => {
    const scoped = sellerId ? files.filter((f) => f.seller_id === sellerId) : files;
    const monthFiles = scoped.filter((f) => new Date(f.created_at) >= startMonth);
    const prevFiles = scoped.filter((f) => {
      const d = new Date(f.created_at);
      return d >= startPrevMonth && d < startMonth;
    });
    const sales: MoneyByCurrency = {};
    const prevSales: MoneyByCurrency = {};
    const utility: MoneyByCurrency = {};
    const collected: MoneyByCurrency = {};
    const receivable: MoneyByCurrency = {};
    for (const f of monthFiles) {
      addMoney(sales, f.currency, saleOf(f));
      addMoney(utility, f.currency, totalsMap.get(f.id)?.utility ?? 0);
    }
    for (const f of prevFiles) addMoney(prevSales, f.currency, saleOf(f));
    for (const c of monthCobros) {
      if (sellerId && c.sellerId !== sellerId) continue;
      addMoney(collected, c.currency, c.amount);
    }
    for (const f of scoped) {
      addMoney(receivable, f.currency, Math.max(totalsMap.get(f.id)?.balance ?? 0, 0));
    }
    return { sales, prevSales, utility, collected, receivable, filesCount: monthFiles.length };
  };

  const agencyStats = buildStats(null);
  const mineStats = mineOnly ? buildStats(member.id) : null;

  // el chart usa solo la moneda dominante; si hay mezcla se aclara en el título
  const chartStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const chartMixed = files.some(
    (f) => f.currency !== currency && new Date(f.created_at) >= chartStart,
  );
  const chart: ChartPoint[] = Array.from({ length: 6 }, (_, i) => {
    const from = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    const bucket = files.filter((f) => {
      const d = new Date(f.created_at);
      return f.currency === currency && d >= from && d < to;
    });
    return {
      label: from.toLocaleDateString("es-AR", { month: "short" }).replace(".", ""),
      agency: bucket.reduce((a, f) => a + saleOf(f), 0),
      mine: bucket
        .filter((f) => f.seller_id === member.id)
        .reduce((a, f) => a + saleOf(f), 0),
    };
  });

  /* ── ranking de vendedores (solo admin) ── */
  let ranking: RankingRow[] = [];
  if (isAdmin) {
    const bySeller = new Map<string, { total: MoneyByCurrency; count: number }>();
    for (const f of monthFilesAll) {
      if (!f.seller_id) continue;
      const cur = bySeller.get(f.seller_id) ?? { total: {}, count: 0 };
      addMoney(cur.total, f.currency, saleOf(f));
      cur.count += 1;
      bySeller.set(f.seller_id, cur);
    }
    ranking = (membersRes.data ?? [])
      .filter((m) => bySeller.has(m.id))
      .map((m) => ({
        id: m.id,
        name: m.display_name,
        avatarUrl: m.avatar_url,
        total: bySeller.get(m.id)!.total,
        count: bySeller.get(m.id)!.count,
      }))
      .sort((a, b) => (b.total[currency] ?? 0) - (a.total[currency] ?? 0));
  }

  /* ── LA PAUTA ── */
  const pautaMap = new Map<string, { leads: number; quoted: number; won: number }>();
  for (const l of pautaRes.data ?? []) {
    const name =
      l.origin_campaign?.trim() ||
      CHANNELS[l.origin_channel as LeadChannel]?.label ||
      "Sin origen";
    const cur = pautaMap.get(name) ?? { leads: 0, quoted: 0, won: 0 };
    cur.leads += 1;
    if (["presupuestado", "negociacion", "ganado"].includes(l.stage)) cur.quoted += 1;
    if (l.stage === "ganado") cur.won += 1;
    pautaMap.set(name, cur);
  }
  const campaigns: CampaignRow[] = [...pautaMap.entries()]
    .map(([name, v]) => ({
      name,
      leads: v.leads,
      quoted: v.quoted,
      won: v.won,
      conv: v.leads > 0 ? Math.round((v.won / v.leads) * 100) : 0,
    }))
    .sort((a, b) => b.leads - a.leads);

  /* ── RADAR ── */
  const departures: DepartureItem[] = (departuresRes.data ?? []).map((f) => {
    const dep = parseYmd(f.departure_date as string);
    return {
      id: f.id,
      contactName: f.contact?.full_name ?? "Sin nombre",
      destination: f.destination,
      date: f.departure_date as string,
      days: Math.max(Math.round((dep.getTime() - startToday.getTime()) / 86400000), 0),
      balance: Math.max(totalsMap.get(f.id)?.balance ?? 0, 0),
      currency: f.currency,
    };
  });

  const documents: DocumentItem[] = (docsRes.data ?? []).map((t) => {
    const exp = parseYmd(t.document_expiry as string);
    return {
      id: t.id,
      travelerName: t.full_name,
      docLabel: DOC_LABELS[t.document_type ?? "otro"] ?? "Documento",
      expiry: t.document_expiry as string,
      daysLeft: Math.round((exp.getTime() - startToday.getTime()) / 86400000),
      contactId: t.contact_id,
    };
  });

  const birthdays: BirthdayItem[] = (birthdaysRes.data ?? [])
    .filter((c) => c.birth_date && Number(c.birth_date.split("-")[1]) === now.getMonth() + 1)
    .sort(
      (a, b) =>
        Number((a.birth_date as string).split("-")[2]) -
        Number((b.birth_date as string).split("-")[2]),
    )
    .map((c) => {
      const day = Number((c.birth_date as string).split("-")[2]);
      const firstName = c.full_name.trim().split(/\s+/)[0];
      return {
        id: c.id,
        name: c.full_name,
        dateLabel: fmtDate(new Date(now.getFullYear(), now.getMonth(), day)),
        isToday: day === now.getDate(),
        waHref: c.phone
          ? waLink(
              c.phone,
              `¡Feliz cumple ${firstName}! 🎉 De parte de todo el equipo de ${agency.name}`,
            )
          : null,
      };
    });

  const funnelCounts = new Map<string, number>();
  for (const l of funnelRes.data ?? []) {
    funnelCounts.set(l.stage, (funnelCounts.get(l.stage) ?? 0) + 1);
  }
  const funnel = STAGES.filter((s) => s.active).map((s) => ({
    key: s.key,
    label: s.label,
    count: funnelCounts.get(s.key) ?? 0,
    dot: s.dot,
    bar: s.headerBar,
  }));

  /* ── header ── */
  const rawToday = now.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const todayLabel = rawToday.charAt(0).toUpperCase() + rawToday.slice(1);
  const firstName = member.display_name.trim().split(/\s+/)[0];
  const consejo = consejoDelDia(member.id, now);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-6 md:px-6">
      <div className="stagger-children">
        <header className="pt-5 md:pt-6">
          <p className="text-xs font-medium text-ink-faint">{todayLabel}</p>
          <h1 className="mt-0.5 font-display text-[30px] font-semibold leading-none tracking-tight text-ink md:text-4xl">
            Hola, {firstName}
          </h1>
          <p className="mt-2 max-w-xl font-display text-[15px] italic leading-snug text-ink-soft md:text-base">
            {consejo}
          </p>
        </header>

        <div className="mt-4 md:mt-5">
          <KpiBand
            showToggle={mineOnly}
            mineStats={mineStats}
            agencyStats={agencyStats}
            currency={currency}
          />
        </div>

        <div className="mt-4 grid gap-4 md:mt-5 lg:grid-cols-12 lg:items-start lg:gap-5">
          <div className="lg:col-span-5">
            <TodaySection
              newLeads={newLeads}
              followupsCount={followupsCount}
              overdueCount={overdueCount}
              unread={unread}
              agenda={agenda}
            />
          </div>
          <div className="space-y-4 lg:col-span-7 lg:space-y-5">
            <InsightsCard
              chart={chart}
              currency={currency}
              chartMixed={chartMixed}
              compare={mineOnly}
              equipoSlot={
                isAdmin ? <SellerRanking rows={ranking} currency={currency} /> : undefined
              }
              pautaSlot={<CampaignTable rows={campaigns} />}
            />
            <RadarSection
              departures={departures}
              documents={documents}
              birthdays={birthdays}
              funnel={funnel}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
