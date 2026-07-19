import { NextResponse } from 'next/server';

export const BILLING_JSON_BODY_LIMIT_BYTES = 8 * 1024;
export const STRIPE_WEBHOOK_BODY_LIMIT_BYTES = 512 * 1024;

export function requestBodyExceedsLimit(request, maxBytes) {
  const contentLength = Number.parseInt(request.headers.get('content-length') || '0', 10);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

export async function readLimitedJsonBody(request, maxBytes = BILLING_JSON_BODY_LIMIT_BYTES) {
  const bodyText = await request.text();
  if (bodyText.length > maxBytes) {
    return { tooLarge: true, body: null };
  }

  return { tooLarge: false, body: bodyText ? JSON.parse(bodyText) : {} };
}

export function payloadTooLargeResponse() {
  return NextResponse.json({ error: 'Payload prea mare.' }, { status: 413 });
}
