import type { Metadata } from "next";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { CajaClient } from "@/components/caja/caja-client";
import { fileCommission, round2 } from "@/lib/domain";
import type {
  CajaStats,
  CajaTab,
  CommissionRow,
  DebtorFile,
  FileOption,
  MoneyByCurrency,
  Movement,
  SellerOption,
} from "@/components/caja/types";
import type { PaymentMethod } from "@/lib/types";

export const metadata: Metadata = { title: "Caja" };

function add(m: MoneyByCurrency, currency: string, amount: number) {
  m[currency] = round2((m[currency] ?? 0) + amount);
}

function addAll(target: MoneyByCurrency, source: MoneyByCurrency) {
  for (const [currency, amount] of Object.entries(source)) add(target, currency, amount);
}

/** suma todas las monedas del mapa sin convertirlas: sirve para ordenar, no para mostrar */
function totalAcrossCurrencies(m: MoneyByCurrency): number {
  return Object.values(m).reduce((acc, v) => acc + v, 0);
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
        "id, paid_at, created_at, direction, amount, currency, exchange_rate, amount_in_file_currency, method, note, receipt_code, receipt_token, member_id, contact:contacts(full_name), supplier:suppliers(name), member:members!payments_member_id_fkey(display_name), file:files(id, code, currency)",
      )
      .gte("paid_at", startDateStr)
      .lt("paid_at", endDateStr)
      .order("paid_at", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("file_totals").select("file_id, total_sale, paid_total, balance, utility"),
    supabase
      .from("files")
      .select(
        "id, code, destination, currency, departure_date, created_at, seller_id, status, commission_pct, commission_type, commission_amount, commission_label, contact:contacts(id, full_name, phone)",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("members")
      .select("id, display_name, commission_pct")
      .eq("is_active", true)
      .order("display_name"),
    supabase.from("suppliers").select("id, name").eq("is_active", true).order("name"),
  ]);

  const payments = paymentsRes.data ?? [];
  const totals = totalsRes.data ?? [];
  const files = filesRes.data ?? [];
  const members = membersRes.data ?? [];
  const suppliers = suppliersRes.data ?? [];

  const totalsByFile = new Map(totals.map((t) => [t.file_id, t]));

  // ── movimientos del mes (incluye pagos de comisión, que pueden no tener file) ──
  // La comisión de un compañero no es asunto de un vendedor: solo el admin las ve todas.
  const visiblePayments = isAdmin
    ? payments
    : payments.filter(
        (p) => p.direction !== "pago_comision" || p.member_id === member.id,
      );

  const movements: Movement[] = visiblePayments.map((p) => ({
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
    member_name: p.member?.display_name ?? null,
    file_id: p.file?.id ?? null,
    file_code: p.file?.code ?? null,
    file_currency: p.file?.currency ?? p.currency,
    amount_in_file_currency: Number(p.amount_in_file_currency),
    exchange_rate: p.exchange_rate != null ? Number(p.exchange_rate) : null,
  }));

  // ── stats de movimientos ──
  const collected: MoneyByCurrency = {};
  const supplierPaid: MoneyByCurrency = {};
  /** comisiones pagadas en el mes, por vendedor y moneda */
  const paidByMember = new Map<string, MoneyByCurrency>();
  /** nombre del vendedor aunque ya no esté activo */
  const sellerNameById = new Map<string, string>(
    members.map((m) => [m.id, m.display_name] as const),
  );

  for (const p of payments) {
    const cur = p.file?.currency ?? p.currency;
    const amt = Number(p.amount_in_file_currency);
    if (p.direction === "cobro") add(collected, cur, amt);
    else if (p.direction === "reembolso") add(collected, cur, -amt);
    else if (p.direction === "pago_proveedor") add(supplierPaid, cur, amt);
    else if (p.direction === "pago_comision" && p.member_id) {
      if (p.member?.display_name) sellerNameById.set(p.member_id, p.member.display_name);
      const acc = paidByMember.get(p.member_id) ?? {};
      add(acc, p.currency, Number(p.amount));
      paidByMember.set(p.member_id, acc);
    }
  }

  const activeFiles = files.filter((f) => f.status !== "cancelado");

  const receivable: MoneyByCurrency = {};
  const debtors: DebtorFile[] = [];
  /** files todavía sin servicios cargados: no tienen saldo, pero se les cobra la seña */
  const withoutServices: DebtorFile[] = [];

  for (const f of activeFiles) {
    const t = totalsByFile.get(f.id);
    const totalSale = round2(Number(t?.total_sale ?? 0));
    const balance = round2(Number(t?.balance ?? 0));
    const row: DebtorFile = {
      id: f.id,
      code: f.code,
      destination: f.destination,
      currency: f.currency,
      departure_date: f.departure_date,
      contact_id: f.contact?.id ?? null,
      contact_name: f.contact?.full_name ?? "Cliente",
      contact_phone: f.contact?.phone ?? null,
      total_sale: totalSale,
      paid_total: round2(Number(t?.paid_total ?? 0)),
      balance,
    };
    if (totalSale <= 0.004) withoutServices.push(row);
    else if (balance > 0) {
      add(receivable, f.currency, balance);
      debtors.push(row);
    }
  }
  debtors.sort((a, b) => b.balance - a.balance);

  // ── comisiones: files creados en el mes ──
  const startIso = monthStart.toISOString();
  const endIso = monthEnd.toISOString();
  const monthFiles = activeFiles.filter(
    (f) => f.created_at >= startIso && f.created_at < endIso,
  );

  const bySeller = new Map<string, typeof monthFiles>();
  for (const f of monthFiles) {
    const key = f.seller_id ?? "unassigned";
    if (!bySeller.has(key)) bySeller.set(key, []);
    bySeller.get(key)!.push(f);
  }
  // vendedores sin ventas este mes pero con comisiones pagadas (liquidación de meses previos)
  for (const memberId of paidByMember.keys()) {
    if (!bySeller.has(memberId)) bySeller.set(memberId, []);
  }

  let commissions: CommissionRow[] = Array.from(bySeller.entries()).map(
    ([sellerId, sellerFiles]) => {
      const util: MoneyByCurrency = {};
      const commission: MoneyByCurrency = {};
      let fixedFiles = 0;

      for (const f of sellerFiles) {
        const t = totalsByFile.get(f.id);
        const u = Number(t?.utility ?? 0);
        add(util, f.currency, u);
        add(
          commission,
          f.currency,
          fileCommission({
            commission_type: f.commission_type,
            commission_pct: Number(f.commission_pct),
            commission_amount: Number(f.commission_amount),
            utility: u,
          }),
        );
        if (f.commission_type === "monto_fijo") fixedFiles += 1;
      }

      const pctFiles = sellerFiles.length - fixedFiles;
      // % congelado: se muestra solo si todos los files del mes son por % y lo comparten
      const pcts = new Set(
        sellerFiles
          .filter((f) => f.commission_type !== "monto_fijo")
          .map((f) => Number(f.commission_pct)),
      );
      const pct = fixedFiles === 0 && pcts.size === 1 ? [...pcts][0] : null;

      const schemeLabel =
        sellerFiles.length === 0
          ? "—"
          : fixedFiles > 0 && pctFiles > 0
            ? "Mixto"
            : fixedFiles > 0
              ? "Monto fijo"
              : pct !== null
                ? `${pct}% utilidad`
                : "% de utilidad";

      const paid = paidByMember.get(sellerId) ?? {};
      const pending: MoneyByCurrency = {};
      for (const [cur, amt] of Object.entries(commission)) {
        const rest = round2(amt - (paid[cur] ?? 0));
        if (rest > 0.004) pending[cur] = rest;
      }

      return {
        memberId: sellerId,
        name:
          sellerId === "unassigned"
            ? "Sin asignar"
            : (sellerNameById.get(sellerId) ?? "Vendedor"),
        filesCount: sellerFiles.length,
        utility: util,
        pct,
        commission,
        paid,
        pending,
        scheme: { fixedFiles, pctFiles },
        schemeLabel,
        payable: sellerId !== "unassigned",
      };
    },
  );
  commissions.sort(
    (a, b) => totalAcrossCurrencies(b.utility) - totalAcrossCurrencies(a.utility),
  );
  // pendiente de cada vendedor antes de filtrar: el admin lo usa para precargar el pago
  const pendingByMember = new Map(commissions.map((c) => [c.memberId, c.pending] as const));

  if (!isAdmin) commissions = commissions.filter((c) => c.memberId === member.id);

  // los totales del tab de comisiones salen de las filas visibles: siempre cierran
  const utility: MoneyByCurrency = {};
  const commissionsDue: MoneyByCurrency = {};
  const commissionsPaid: MoneyByCurrency = {};
  for (const c of commissions) {
    addAll(utility, c.utility);
    addAll(commissionsDue, c.commission);
    addAll(commissionsPaid, c.paid);
  }

  const stats: CajaStats = {
    collected,
    supplierPaid,
    receivable,
    utility,
    commissionsDue,
    commissionsPaid,
  };

  const fileOptions: FileOption[] = activeFiles.map((f) => ({
    id: f.id,
    code: f.code,
    destination: f.destination,
    currency: f.currency,
    contact_name: f.contact?.full_name ?? "Cliente",
  }));

  const sellers: SellerOption[] = members.map((m) => ({
    id: m.id,
    name: m.display_name,
    pending: pendingByMember.get(m.id) ?? {},
  }));

  // a quién se le puede cobrar hoy: primero los saldos, después los files sin servicios
  const chargeable: DebtorFile[] = [...debtors, ...withoutServices];

  // moneda con la que más se opera: cuando no hay movimientos, los KPIs no inventan USD
  const currencyUse = new Map<string, number>();
  for (const f of activeFiles) currencyUse.set(f.currency, (currencyUse.get(f.currency) ?? 0) + 1);
  for (const p of payments) currencyUse.set(p.currency, (currencyUse.get(p.currency) ?? 0) + 1);
  const mainCurrency = [...currencyUse.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

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
        chargeable={chargeable}
        commissions={commissions}
        suppliers={suppliers}
        sellers={sellers}
        fileOptions={fileOptions}
        mainCurrency={mainCurrency}
        isAdmin={isAdmin}
      />
    </div>
  );
}
