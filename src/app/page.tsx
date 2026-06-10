import { SiteHeader } from '@/components/site-header';
import HomeClient from './home-client';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main id="main-content" className="flex-1">
        <HomeClient />
      </main>
    </div>
  );
}
