import {
  Home,
  KanbanSquare,
  ReceiptText,
  Users,
  FolderOpen,
  Wallet,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const NAV_MAIN: NavItem[] = [
  { href: "/inicio", label: "Inicio", icon: Home },
  { href: "/crm", label: "CRM", icon: KanbanSquare },
  { href: "/presupuestos", label: "Presupuestos", icon: ReceiptText },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/files", label: "Files", icon: FolderOpen },
  { href: "/caja", label: "Caja", icon: Wallet },
];

export const NAV_CONFIG: NavItem = {
  href: "/config",
  label: "Configuración",
  icon: Settings,
};

/** Tabs de mobile: las 4 más usadas + "Más" se maneja en el componente */
export const NAV_MOBILE: NavItem[] = [
  { href: "/inicio", label: "Inicio", icon: Home },
  { href: "/crm", label: "CRM", icon: KanbanSquare },
  { href: "/presupuestos", label: "Presupuestos", icon: ReceiptText },
  { href: "/files", label: "Files", icon: FolderOpen },
];
