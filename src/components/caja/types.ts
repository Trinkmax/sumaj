import type { PaymentMethod } from "@/lib/types";

/** file mínimo que necesita el PaymentDialog (contrato con files/[id]) */
export type PaymentFile = {
  id: string;
  code: string;
  currency: string;
  contact_id: string | null;
  contact_name: string;
  balance: number;
};

/** movimiento de caja (fila de la lista) */
export type Movement = {
  id: string;
  paid_at: string;
  direction: "cobro" | "pago_proveedor" | "reembolso";
  amount: number;
  currency: string;
  method: PaymentMethod;
  note: string | null;
  receipt_code: string | null;
  receipt_token: string;
  contact_name: string | null;
  supplier_name: string | null;
  file_id: string;
  file_code: string;
  /** moneda del file (para mostrar la conversión cuando el pago fue cross-currency) */
  file_currency: string;
  /** monto normalizado a la moneda del file */
  amount_in_file_currency: number;
  /** cotización usada (ARS por USD) si el pago fue en otra moneda */
  exchange_rate: number | null;
};

/** file con saldo pendiente (cuenta corriente + picker de cobro) */
export type DebtorFile = {
  id: string;
  code: string;
  destination: string;
  currency: string;
  departure_date: string | null;
  contact_id: string | null;
  contact_name: string;
  contact_phone: string | null;
  total_sale: number;
  paid_total: number;
  balance: number;
};

/** opción de file para el pago a proveedor */
export type FileOption = {
  id: string;
  code: string;
  destination: string;
  currency: string;
  contact_name: string;
};

export type SupplierOption = { id: string; name: string };

/** montos agrupados por moneda: { USD: 1200, ARS: 350000 } */
export type MoneyByCurrency = Record<string, number>;

export type CommissionRow = {
  memberId: string;
  name: string;
  filesCount: number;
  sale: MoneyByCurrency;
  utility: MoneyByCurrency;
  /** % congelado por file; null si los files del mes tienen % distintos */
  pct: number | null;
  commission: MoneyByCurrency;
};

export type CajaStats = {
  collected: MoneyByCurrency;
  supplierPaid: MoneyByCurrency;
  receivable: MoneyByCurrency;
  utility: MoneyByCurrency;
};

export type CajaTab = "movimientos" | "cuenta" | "comisiones";
