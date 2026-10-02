import { DecidedList } from '@/components/labels/decided-list';
import { toLabelView } from '@/lib/labels/label-view';
import { getLabelRepository } from '@/lib/labels/server-deps';

export const dynamic = 'force-dynamic';

export default async function DecidedPage() {
  const repo = getLabelRepository();
  const records = await repo.list({ statuses: ['approved', 'rejected'], limit: 500 });
  const decisions = await repo.listDecisionsFor(records.map((record) => record.id));
  const views = records.map((record) => toLabelView(record, decisions.get(record.id)));
  return <DecidedList labels={views} />;
}
