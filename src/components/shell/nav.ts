import type * as React from "react";
import {
  IconCaja,
  IconClientes,
  IconConfig,
  IconCrm,
  IconFiles,
  IconInicio,
  IconPresupuestos,
  type NavIconProps,
} from "./nav-icons";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<NavIconProps>;
};

export const NAV_MAIN: NavItem[] = [
  { href: "/inicio", label: "Inicio", icon: IconInicio },
  { href: "/crm", label: "CRM", icon: IconCrm },
  { href: "/presupuestos", label: "Presupuestos", icon: IconPresupuestos },
  { href: "/clientes", label: "Clientes", icon: IconClientes },
  { href: "/files", label: "Files", icon: IconFiles },
  { href: "/caja", label: "Caja", icon: IconCaja },
];

export const NAV_CONFIG: NavItem = {
  href: "/config",
  label: "Configuración",
  icon: IconConfig,
};

/** Tabs de mobile: las 4 más usadas + "Más" se maneja en el componente */
export const NAV_MOBILE: NavItem[] = [
  { href: "/inicio", label: "Inicio", icon: IconInicio },
  { href: "/crm", label: "CRM", icon: IconCrm },
  { href: "/presupuestos", label: "Presupuestos", icon: IconPresupuestos },
  { href: "/files", label: "Files", icon: IconFiles },
];
