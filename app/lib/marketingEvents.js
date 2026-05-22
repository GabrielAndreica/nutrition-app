'use client';

export function trackMarketingEvent(name, parameters = {}) {
  if (typeof window === 'undefined' || !name) return;

  window.dispatchEvent(new CustomEvent('trevano-marketing-event', {
    detail: {
      name,
      parameters,
    },
  }));
}
