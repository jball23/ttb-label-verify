import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findApplicationById } from '@/db/applications';
import { listReviewsForApplication } from '@/db/reviews';
import { tryGetDb } from '@/db/client';
import { isFinalized } from '@/db/schema';
import DetailReportView from '@/components/detail-report-view';
import ReviewHistory from '@/components/review-history';
import PdfModal from '@/components/pdf-modal';
import { Check, X } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ApplicationDetailPage({ params }: PageProps) {
  const { id } = await params;

  if (!tryGetDb()) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <p className="text-sm text-muted-foreground">
          DATABASE_URL is not configured.
        </p>
      </div>
    );
  }

  const row = await findApplicationById(id);
  if (!row) notFound();

  const reviews = await listReviewsForApplication(id);
  const report = row.validationReport;
  const finalized = isFinalized(row.currentStatus);

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
      <Link
        href={finalized ? '/applications' : '/'}
        className="mb-3 inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
      >
        ← {finalized ? 'All applications' : 'Back to Queue'}
      </Link>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">
              {row.sourceFilename}
            </h1>
            <FinalStatusBadge status={row.currentStatus} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Processed {row.createdAt.toLocaleString()} · {row.extractorModel} · prompt {row.promptVersion}
          </p>
        </div>
        <PdfModal
          filename={row.sourceFilename}
          source={{
            kind: 'stored',
            applicationId: row.id,
            hasStoredPdf: row.hasPdfBytes,
          }}
        />
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <DetailReportView report={report} />
        <div className="space-y-4">
          <ReviewHistory reviews={reviews} />
        </div>
      </div>
    </div>
  );
}

function FinalStatusBadge({ status }: { status: string }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
        <Check className="size-3" /> Approved
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
        <X className="size-3" /> Rejected
      </span>
    );
  }
  // Pending approval/rejection — shouldn't normally land here, but render
  // a graceful pill if it does.
  const pending = status === 'pending_approval' ? 'Pending approval' : 'Pending rejection';
  return (
    <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
      {pending}
    </span>
  );
}
