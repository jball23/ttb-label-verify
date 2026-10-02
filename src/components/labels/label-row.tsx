import Link from 'next/link';
import { type ReactNode } from 'react';

interface LabelRowProps {
  title: string;
  detail: string;
  thumbnailUrl: string;
  chip: ReactNode;
  /** Where Review goes; omitted while the label is still being checked. */
  href?: string;
  action?: ReactNode;
}

/** One label in a list: thumbnail, what it is, what matters, and its status. */
export function LabelRow({
  title,
  detail,
  thumbnailUrl,
  chip,
  href,
  action,
}: LabelRowProps) {
  return (
    <li className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-4 py-4 sm:grid-cols-[64px_minmax(0,1fr)_auto_7rem] sm:px-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- blob: and API URLs, not static assets */}
      <img
        src={thumbnailUrl}
        alt=""
        className="h-[72px] w-14 rounded-md border border-border bg-muted object-cover sm:h-20 sm:w-16"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="truncate text-lg font-semibold">{title}</p>
        <p className="text-base text-muted-foreground">{detail}</p>
      </div>
      <div className="col-start-2 sm:col-start-auto">{chip}</div>
      <div className="col-start-2 sm:col-start-auto sm:justify-self-end">
        {href ? (
          <Link
            href={href}
            className="text-lg font-semibold underline underline-offset-4 hover:no-underline"
          >
            Review
          </Link>
        ) : (
          action
        )}
      </div>
    </li>
  );
}
