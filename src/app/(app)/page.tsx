import { CheckLabelsPage } from '@/components/labels/check-labels-page';
import { toLabelView } from '@/lib/labels/label-view';
import { getLabelRepository } from '@/lib/labels/server-deps';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const waiting = await getLabelRepository().list({
    statuses: ['to_review'],
    limit: 500,
  });
  return <CheckLabelsPage waiting={waiting.map((record) => toLabelView(record))} />;
}
