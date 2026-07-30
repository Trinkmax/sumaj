import type { PaymentDirection, PaymentMethod } from "@/lib/types";

/** file mínimo que necesita el PaymentDialog (contrato con files/[id]) */
export type PaymentFile = {
  id: string;
  code: string;
  currency: string;
  contact_id: string | null;
  contact_name: string;
  /** venta total del file: 0 = todavía no tiene servicios cargados */
  total_sale: number;
  balance: number;
};

/** movimiento de caja (fila de la lista) */
export type Movement = {
  id: string;
  paid_at: string;
  direction: PaymentDirection;
  amount: number;
  currency: string;
  method: PaymentMethod;
  note: string | null;
  receipt_code: string | null;
  receipt_token: string;
  contact_name: string | null;
  supplier_name: string | null;
  /** vendedor cobrado (solo en pago_comision) */
  member_name: string | null;
  /** null en las liquidaciones de comisión sin file */
  file_id: string | null;
  file_code: string | null;
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

/** vendedor al que se le puede pagar una comisión */
export type SellerOption = {
  id: string;
  name: string;
  /** comisión pendiente del período: precarga el monto al elegirlo */
  pending: MoneyByCurrency;
};

/** montos agrupados por moneda: { USD: 1200, ARS: 350000 } */
export type MoneyByCurrency = Record<string, number>;

/** cómo se calcularon las comisiones del vendedor en el período */
export type CommissionScheme = {
  /** files con comisión de monto fijo */
  fixedFiles: number;
  /** files con comisión como % de la utilidad */
  pctFiles: number;
};

export type CommissionRow = {
  memberId: string;
  name: string;
  filesCount: number;
  utility: MoneyByCurrency;
  /** % congelado por file; null si los files del mes tienen % distintos o hay montos fijos */
  pct: number | null;
  /** comisión ganada en el período (esquema de cada file) */
  commission: MoneyByCurrency;
  /** comisiones ya pagadas en el período */
  paid: MoneyByCurrency;
  /** comisión − pagado (nunca negativo) */
  pending: MoneyByCurrency;
  scheme: CommissionScheme;
  /** resumen listo para mostrar: "20% utilidad" · "Monto fijo" · "Mixto" */
  schemeLabel: string;
  /** false para el grupo "Sin asignar": no se le puede pagar */
  payable: boolean;
};

export type CajaStats = {
  collected: MoneyByCurrency;
  supplierPaid: MoneyByCurrency;
  receivable: MoneyByCurrency;
  utility: MoneyByCurrency;
  /** comisiones generadas en el período */
  commissionsDue: MoneyByCurrency;
  /** comisiones efectivamente pagadas en el período */
  commissionsPaid: MoneyByCurrency;
};

export type CajaTab = "movimientos" | "cuenta" | "comisiones";
