import { BatchProvider } from '@/components/labels/batch-provider';
import { SiteHeader } from '@/components/site-header';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    // The batch lives above every page so it keeps running while a label is reviewed.
    <BatchProvider>
      <div className="flex min-h-svh flex-col">
        <SiteHeader />
        <main id="main-content" className="flex-1">
          {children}
        </main>
      </div>
    </BatchProvider>
  );
}
