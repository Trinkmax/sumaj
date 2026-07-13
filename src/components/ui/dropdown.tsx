"use client";

import * as React from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const Dropdown = DropdownPrimitive.Root;
export const DropdownTrigger = DropdownPrimitive.Trigger;

export function DropdownContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 min-w-[180px] overflow-hidden rounded-2xl border border-line bg-paper p-1.5 shadow-lg shadow-ink/5",
          "origin-[var(--radix-dropdown-menu-content-transform-origin)] data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out",
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownItem({
  className,
  destructive,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & {
  destructive?: boolean;
}) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors",
        destructive
          ? "text-tone-red-text data-[highlighted]:bg-tone-red-soft"
          : "text-ink data-[highlighted]:bg-sand-soft",
        "[&_svg]:size-4 [&_svg]:text-ink-faint",
        destructive && "[&_svg]:text-tone-red-text",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownSeparator() {
  return <DropdownPrimitive.Separator className="mx-1 my-1 h-px bg-line" />;
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return (
    <DropdownPrimitive.Label className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
      {children}
    </DropdownPrimitive.Label>
  );
}
