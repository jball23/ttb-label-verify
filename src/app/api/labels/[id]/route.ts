import { getLabel } from '@/lib/labels/label-service';
import { getLabelRepository } from '@/lib/labels/server-deps';
import { handle } from '../http';

export const runtime = 'nodejs';

export const GET = handle(async (_request, { params }) =>
  getLabel({ repo: getLabelRepository() }, (await params).id),
);
