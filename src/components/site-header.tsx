import { ShieldCheck } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { AboutDialog } from '@/components/about-dialog';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
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
        </div>
        <div className="flex items-center gap-1">
          <AboutDialog />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
