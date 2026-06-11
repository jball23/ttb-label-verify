import { SiteHeader } from '@/components/site-header';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main id="main-content" className="flex-1">
        {children}
      </main>
    </div>
  );
}
