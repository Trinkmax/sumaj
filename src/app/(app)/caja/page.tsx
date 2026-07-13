import type { Metadata } from "next";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { CajaClient } from "@/components/caja/caja-client";
import { round2 } from "@/lib/domain";
import type {
  CajaStats,
  CajaTab,
  CommissionRow,
  DebtorFile,
  FileOption,
  MoneyByCurrency,
  Movement,
} from "@/components/caja/types";
import type { PaymentMethod } from "@/lib/types";

export const metadata: Metadata = { title: "Caja" };

function add(m: MoneyByCurrency, currency: string, amount: number) {
  m[currency] = round2((m[currency] ?? 0) + amount);
}

export default async function CajaPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; tab?: string }>;
}) {
  const { member, isAdmin } = await requireMember();
  const supabase = await createClient();
  const params = await searchParams;

  // ── mes seleccionado ──
  const now = new Date();
  const defaultKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.m ?? "") ? params.m! : defaultKey;
  const [year, month] = monthKey.split("-").map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const nextKey = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, "0")}`;
  const startDateStr = `${monthKey}-01`;
  const endDateStr = `${nextKey}-01`;
  const monthLabel = `${monthStart.toLocaleDateString("es-AR", { month: "long" })} ${year}`;

  const initialTab: CajaTab =
    params.tab === "cuenta" || params.tab === "comisiones" ? params.tab : "movimientos";

  // ── datos ──
  const [paymentsRes, totalsRes, filesRes, membersRes, suppliersRes] = await Promise.all([
    supabase
      .from("payments")
      .select(
        "id, paid_at, created_at, direction, amount, currency, amount_in_file_currency, method, note, receipt_code, receipt_token, contact:contacts(full_name), supplier:suppliers(name), file:files(id, code, currency)",
      )
      .gte("paid_at", startDateStr)
      .lt("paid_at", endDateStr)
      .order("paid_at", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("file_totals").select("file_id, total_sale, paid_total, balance, utility"),
    supabase
      .from("files")
      .select(
        "id, code, destination, currency, departure_date, created_at, seller_id, status, commission_pct, contact:contacts(id, full_name, phone)",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("members")
      .select("id, display_name, commission_pct")
      .eq("is_active", true),
    supabase.from("suppliers").select("id, name").eq("is_active", true).order("name"),
  ]);

  const payments = paymentsRes.data ?? [];
  const totals = totalsRes.data ?? [];
  const files = filesRes.data ?? [];
  const members = membersRes.data ?? [];
  const suppliers = suppliersRes.data ?? [];

  const totalsByFile = new Map(totals.map((t) => [t.file_id, t]));
  const memberById = new Map(members.map((m) => [m.id, m]));

  // ── movimientos del mes ──
  const movements: Movement[] = payments
    .filter((p) => p.file)
    .map((p) => ({
      id: p.id,
      paid_at: p.paid_at,
      direction: p.direction,
      amount: Number(p.amount),
      currency: p.currency,
      method: p.method as PaymentMethod,
      note: p.note,
      receipt_code: p.receipt_code,
      receipt_token: p.receipt_token,
      contact_name: p.contact?.full_name ?? null,
      supplier_name: p.supplier?.name ?? null,
      file_id: p.file!.id,
      file_code: p.file!.code,
    }));

  // ── stats ──
  const collected: MoneyByCurrency = {};
  const supplierPaid: MoneyByCurrency = {};
  for (const p of payments) {
    const cur = p.file?.currency ?? p.currency;
    const amt = Number(p.amount_in_file_currency);
    if (p.direction === "cobro") add(collected, cur, amt);
    else if (p.direction === "reembolso") add(collected, cur, -amt);
    else add(supplierPaid, cur, amt);
  }

  const activeFiles = files.filter((f) => f.status !== "cancelado");

  const receivable: MoneyByCurrency = {};
  const debtors: DebtorFile[] = activeFiles
    .map((f) => {
      const t = totalsByFile.get(f.id);
      const balance = round2(Number(t?.balance ?? 0));
      return { f, t, balance };
    })
    .filter(({ balance }) => balance > 0)
    .map(({ f, t, balance }) => {
      add(receivable, f.currency, balance);
      return {
        id: f.id,
        code: f.code,
        destination: f.destination,
        currency: f.currency,
        departure_date: f.departure_date,
        contact_id: f.contact?.id ?? null,
        contact_name: f.contact?.full_name ?? "Cliente",
        contact_phone: f.contact?.phone ?? null,
        total_sale: round2(Number(t?.total_sale ?? 0)),
        paid_total: round2(Number(t?.paid_total ?? 0)),
        balance,
      };
    })
    .sort((a, b) => b.balance - a.balance);

  // ── utilidad y comisiones: files creados en el mes ──
  const startIso = monthStart.toISOString();
  const endIso = monthEnd.toISOString();
  const monthFiles = activeFiles.filter(
    (f) => f.created_at >= startIso && f.created_at < endIso,
  );

  const utility: MoneyByCurrency = {};
  for (const f of monthFiles) {
    add(utility, f.currency, Number(totalsByFile.get(f.id)?.utility ?? 0));
  }

  const bySeller = new Map<string, typeof monthFiles>();
  for (const f of monthFiles) {
    const key = f.seller_id ?? "unassigned";
    if (!bySeller.has(key)) bySeller.set(key, []);
    bySeller.get(key)!.push(f);
  }

  let commissions: CommissionRow[] = Array.from(bySeller.entries()).map(
    ([sellerId, sellerFiles]) => {
      const m = memberById.get(sellerId);
      const sale: MoneyByCurrency = {};
      const util: MoneyByCurrency = {};
      const commission: MoneyByCurrency = {};
      for (const f of sellerFiles) {
        const t = totalsByFile.get(f.id);
        const u = Number(t?.utility ?? 0);
        add(sale, f.currency, Number(t?.total_sale ?? 0));
        add(util, f.currency, u);
        add(commission, f.currency, round2((u * Number(f.commission_pct)) / 100));
      }
      // % congelado por file: se muestra solo si todos los files del mes lo comparten
      const pcts = new Set(sellerFiles.map((f) => Number(f.commission_pct)));
      return {
        memberId: sellerId,
        name: m?.display_name ?? "Sin asignar",
        filesCount: sellerFiles.length,
        sale,
        utility: util,
        pct: pcts.size === 1 ? [...pcts][0] : null,
        commission,
      };
    },
  );
  commissions.sort(
    (a, b) =>
      (b.utility.USD ?? 0) + (b.utility.ARS ?? 0) - ((a.utility.USD ?? 0) + (a.utility.ARS ?? 0)),
  );
  if (!isAdmin) commissions = commissions.filter((c) => c.memberId === member.id);

  const stats: CajaStats = { collected, supplierPaid, receivable, utility };

  const fileOptions: FileOption[] = activeFiles.map((f) => ({
    id: f.id,
    code: f.code,
    destination: f.destination,
    currency: f.currency,
    contact_name: f.contact?.full_name ?? "Cliente",
  }));

  return (
    <div>
      <PageHeader title="Caja" subtitle="Cobros, saldos y comisiones, sin vueltas" />
      <CajaClient
        monthKey={monthKey}
        monthLabel={monthLabel}
        initialTab={initialTab}
        stats={stats}
        movements={movements}
        debtors={debtors}
        commissions={commissions}
        suppliers={suppliers}
        fileOptions={fileOptions}
        isAdmin={isAdmin}
      />
    </div>
  );
}
