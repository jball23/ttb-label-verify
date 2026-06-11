import Link from 'next/link';
import { ShieldCheck, ListTodo } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { AboutDialog } from '@/components/about-dialog';

/**
 * Two-tier header. Top row holds the rarely-used secondary nav (About,
 * theme toggle); the main row is the primary surface — logo on the left,
 * Applications archive + Queue primary CTA on the right.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      {/* Secondary tier — small, right-aligned */}
      <div className="border-b border-border/60">
        <div className="mx-auto flex h-7 max-w-[1500px] items-center justify-end gap-1 px-4 sm:px-6">
          <AboutDialog />
          <ThemeToggle />
        </div>
      </div>

      {/* Main nav */}
      <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-foreground text-background">
            <ShieldCheck className="size-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">
              TTB Label Verification
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Compliance prototype
            </span>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/applications"
            className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          >
            Archive
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <ListTodo className="size-3.5" />
            Queue
          </Link>
        </div>
      </div>
    </header>
  );
}
