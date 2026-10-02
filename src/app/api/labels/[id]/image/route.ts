import { LabelNotFoundError } from '@/lib/labels/errors';
import { getLabelRepository } from '@/lib/labels/server-deps';
import { handle } from '../../http';

export const runtime = 'nodejs';

export const GET = handle(async (_request, { params }) => {
  const image = await getLabelRepository().getImage((await params).id);
  if (!image) throw new LabelNotFoundError();
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.mimeType,
      // A stored image never changes, so browsers may keep it.
      'Cache-Control': 'private, max-age=86400, immutable',
    },
  });
});
