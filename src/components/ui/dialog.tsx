"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * En mobile sube desde abajo (bottom sheet), en desktop es modal centrado.
 * size: "md" formularios simples · "lg" formularios anchos · "xl" cotizador
 */
export function DialogContent({
  className,
  children,
  title,
  description,
  size = "md",
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  size?: "md" | "lg" | "xl";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col bg-cream shadow-2xl focus:outline-none",
          // mobile: bottom sheet
          "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl data-[state=open]:animate-slide-up",
          // desktop: modal centrado
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:data-[state=open]:animate-scale-in",
          size === "md" && "sm:w-full sm:max-w-md",
          size === "lg" && "sm:w-full sm:max-w-2xl",
          size === "xl" && "sm:w-full sm:max-w-5xl",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-1 pt-5 sm:px-6">
          <div>
            <DialogPrimitive.Title className="font-display text-xl font-semibold tracking-tight text-ink">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-sm text-ink-soft">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="rounded-full p-1.5 text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink">
            <X className="size-4.5" />
            <span className="sr-only">Cerrar</span>
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-6">
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
