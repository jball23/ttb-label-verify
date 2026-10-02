import { notFound } from 'next/navigation';
import { ReviewScreen, type QueueEntry } from '@/components/labels/review-screen';
import { LabelNotFoundError } from '@/lib/labels/errors';
import { getLabel } from '@/lib/labels/label-service';
import { toLabelView } from '@/lib/labels/label-view';
import { byProblemsFirst, labelTitle } from '@/lib/labels/presentation';
import { getLabelRepository } from '@/lib/labels/server-deps';

export const dynamic = 'force-dynamic';

export default async function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = getLabelRepository();
  const [label, waiting] = await Promise.all([
    getLabel({ repo }, id).catch((error: unknown) => {
      if (error instanceof LabelNotFoundError) notFound();
      throw error;
    }),
    repo.list({ statuses: ['to_review'], limit: 500 }),
  ]);

  const queue: QueueEntry[] = waiting
    .map((record) => toLabelView(record))
    .sort(byProblemsFirst)
    .map((view) => ({
      id: view.id,
      title: labelTitle(view.report, view.filename),
      verdict: view.report.verdict,
      imageUrl: view.imageUrl,
    }));

  return <ReviewScreen key={label.id} initial={label} queue={queue} />;
}
