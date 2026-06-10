'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface DropdownContextValue {
  open: boolean;
  setOpen(v: boolean): void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const DropdownContext = React.createContext<DropdownContextValue | null>(null);

export function Dropdown({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent): void {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      const menu = document.querySelector('[data-dropdown-menu]');
      if (menu && !menu.contains(target)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <DropdownContext.Provider value={{ open, setOpen, triggerRef }}>
      <div className="relative inline-block">{children}</div>
    </DropdownContext.Provider>
  );
}

export function DropdownTrigger({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = React.useContext(DropdownContext)!;
  return (
    <button
      ref={ctx.triggerRef}
      type="button"
      onClick={() => ctx.setOpen(!ctx.open)}
      aria-expanded={ctx.open}
      aria-haspopup="true"
      className={cn('inline-flex items-center justify-center cursor-pointer', className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function DropdownContent({
  children,
  className,
  align = 'end',
}: {
  children: React.ReactNode;
  className?: string;
  align?: 'start' | 'end';
}) {
  const ctx = React.useContext(DropdownContext)!;
  if (!ctx.open) return null;
  return (
    <div
      data-dropdown-menu
      role="menu"
      className={cn(
        'absolute top-full mt-2 z-50 min-w-[10rem] rounded-md border border-border bg-popover text-popover-foreground shadow-lg',
        'animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150',
        align === 'end' ? 'right-0' : 'left-0',
        className,
      )}
    >
      <div className="p-1">{children}</div>
    </div>
  );
}

export function DropdownItem({
  children,
  className,
  onSelect,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { onSelect?: () => void }) {
  const ctx = React.useContext(DropdownContext)!;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onSelect?.();
        ctx.setOpen(false);
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:outline-none cursor-pointer',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
