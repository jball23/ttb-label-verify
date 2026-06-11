import {
  countByQueueBucket,
  listApplicationsByStatus,
  listFinalizedNotArchived,
  type ApplicationSummary,
} from '@/db/applications';
import { tryGetDb } from '@/db/client';
import QueuePage from '@/components/queue-page';

export const dynamic = 'force-dynamic';

export interface QueueData {
  approvedPending: ApplicationSummary[];
  rejectedPending: ApplicationSummary[];
  finalized: ApplicationSummary[];
  counts: { queue: number; approved: number; rejected: number; finalized: number };
}

export default async function HomePage() {
  // DB-less mode renders the queue with empty server data; the client
  // component still works (in-flight uploads stay in-memory) but the
  // Approved/Rejected/Finalized tabs show "Database not configured."
  if (!tryGetDb()) {
    return (
      <QueuePage
        initial={{
          approvedPending: [],
          rejectedPending: [],
          finalized: [],
          counts: { queue: 0, approved: 0, rejected: 0, finalized: 0 },
        }}
        databaseConnected={false}
      />
    );
  }

  const [approvedPending, rejectedPending, finalized, counts] = await Promise.all([
    listApplicationsByStatus(['pending_approval'], 100),
    listApplicationsByStatus(['pending_rejection'], 100),
    listFinalizedNotArchived(100),
    countByQueueBucket(),
  ]);

  return (
    <QueuePage
      initial={{
        approvedPending,
        rejectedPending,
        finalized,
        // Note: server-side queue count is always 0 because nothing
        // persists in 'queued'/'processing'. Queue tab count is driven
        // by client-side in-flight state.
        counts: {
          queue: 0,
          approved: counts.pending_approval,
          rejected: counts.pending_rejection,
          finalized: counts.finalized,
        },
      }}
      databaseConnected
    />
  );
}
