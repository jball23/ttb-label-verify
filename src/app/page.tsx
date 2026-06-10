import GovBannerWrapper from '@/components/gov-banner';
import PageHeader from '@/components/page-header';
import HomeClient from './home-client';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <>
      <GovBannerWrapper />
      <PageHeader />
      <main id="main-content">
        <HomeClient />
      </main>
    </>
  );
}
