import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { NavLinks } from './nav-links';

/** Name on the left, the two places a reviewer works on the right. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex min-h-16 max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-foreground text-background">
            <ShieldCheck aria-hidden className="size-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Label Check</span>
        </Link>
        <div className="flex items-center gap-2">
          <NavLinks />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
