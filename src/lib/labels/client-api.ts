import { type CorrectionValues } from './corrections';
import { type LabelDecision } from './label-record';
import { type LabelView } from './label-view';
import { type ExpectedValues } from './reading';

/** Browser-side calls to /api/labels. Every failure throws with the server's plain message. */

export function checkLabelImage(image: File, batchId: string): Promise<LabelView> {
  const form = new FormData();
  form.set('image', image);
  form.set('batchId', batchId);
  return request('/api/labels', { method: 'POST', body: form });
}

export function saveReviewerValues(
  id: string,
  values: { expected?: ExpectedValues; corrections?: CorrectionValues; reviewer?: string | null },
): Promise<LabelView> {
  return request(`/api/labels/${id}`, json('PATCH', values));
}

export function decide(
  id: string,
  body: { decision: LabelDecision; reason?: string | null; reviewer?: string | null },
): Promise<LabelView> {
  return request(`/api/labels/${id}/decision`, json('POST', body));
}

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

async function request(url: string, init: RequestInit): Promise<LabelView> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const body = (await response.json().catch(() => null)) as (LabelView & { error?: string }) | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? 'Something went wrong. Try again.');
  }
  return body;
}
