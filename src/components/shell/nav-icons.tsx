import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Iconos de navegación con micro-animaciones propias.
 * Dibujados a mano (24×24, trazo 2, puntas redondas — misma gramática que lucide)
 * con las partes separadas en <path> para poder animarlas por CSS.
 * Las animaciones se disparan con el hover del `.group` padre (ver globals.css,
 * bloque "micro-animaciones de navegación").
 */

export type NavIconProps = { className?: string; strokeWidth?: number };

function Svg({
  className,
  strokeWidth = 2,
  children,
}: NavIconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Inicio: la puerta se asoma al hover. */
export function IconInicio(p: NavIconProps) {
  return (
    <Svg {...p}>
      <path d="M3 10.8 12 3l9 7.8" />
      <path d="M5 9.3V21h14V9.3" />
      <path className="ni-door" d="M10 21v-6h4v6" />
    </Svg>
  );
}

/** CRM: burbuja de mensajería con puntitos "escribiendo…". */
export function IconCrm(p: NavIconProps) {
  return (
    <Svg {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
      <circle className="ni-dot ni-dot-1" cx="8.4" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle className="ni-dot ni-dot-2" cx="12" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle className="ni-dot ni-dot-3" cx="15.6" cy="10" r="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Presupuestos: las líneas del recibo se deslizan en cascada. */
export function IconPresupuestos(p: NavIconProps) {
  return (
    <Svg {...p}>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path className="ni-line ni-line-1" d="M8 8h8" />
      <path className="ni-line ni-line-2" d="M8 12h8" />
      <path className="ni-line ni-line-3" d="M8 16h5" />
    </Svg>
  );
}

/** Clientes: la segunda persona se acerca al grupo. */
export function IconClientes(p: NavIconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
      <g className="ni-user-back">
        <path d="M16 3.1a4 4 0 0 1 0 7.8" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
      </g>
    </Svg>
  );
}

/** Files: la tapa de la carpeta se entreabre. */
export function IconFiles(p: NavIconProps) {
  return (
    <Svg {...p}>
      <path d="M2 19V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v1" />
      <path
        className="ni-flap"
        d="M6 14l1.5-2.9A2 2 0 0 1 9.3 10H20a2 2 0 0 1 1.9 2.5l-1.5 6a2 2 0 0 1-2 1.5H4a2 2 0 0 1-2-2"
      />
    </Svg>
  );
}

/** Caja: la moneda del broche late. */
export function IconCaja(p: NavIconProps) {
  return (
    <Svg {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M3 9.5h11" />
      <circle className="ni-coin" cx="16.8" cy="13.5" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Configuración: el engranaje gira al hover. */
export function IconConfig({ className, strokeWidth }: NavIconProps) {
  return (
    <Settings
      className={cn("transition-transform duration-300 group-hover:rotate-45", className)}
      strokeWidth={strokeWidth}
    />
  );
}
