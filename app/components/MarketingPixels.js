'use client';

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'trevano_cookie_consent';
const CONSENT_VERSION = 4;
const MARKETING_PIXELS_ENABLED = process.env.NEXT_PUBLIC_MARKETING_PIXELS_ENABLED === 'true';

const PROTECTED_ROUTE_PREFIXES = [
  '/dashboard',
  '/clients',
  '/client',
  '/generator-plan',
  '/generator-antrenament',
  '/meal-plan',
  '/workout-plan',
];

function isProtectedRoute(pathname) {
  return PROTECTED_ROUTE_PREFIXES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function hasMarketingConsent() {
  try {
    if (!MARKETING_PIXELS_ENABLED) return false;
    if (typeof window === 'undefined') return false;

    const rawConsent = window.localStorage.getItem(STORAGE_KEY);
    if (!rawConsent) return false;

    const consent = JSON.parse(rawConsent);
    return consent?.value === 'accepted' && consent?.marketing === true && Number(consent?.version) >= CONSENT_VERSION;
  } catch {
    return false;
  }
}

function initMetaPixel(pixelId) {
  if (!pixelId || window.__trevanoMetaPixelInitialized) return;

  if (!window.fbq) {
    const fbq = function fbq() {
      fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
    };

    if (!window._fbq) window._fbq = fbq;

    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];
    window.fbq = fbq;

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript.parentNode.insertBefore(script, firstScript);
  }

  window.fbq('consent', 'grant');
  window.fbq('init', pixelId);
  window.__trevanoMetaPixelInitialized = true;
}

function trackMetaPageView() {
  if (window.fbq) {
    window.fbq('track', 'PageView');
  }
}

function initTikTokPixel(pixelId) {
  if (!pixelId || window.__trevanoTikTokPixelInitialized) return;

  if (!window.ttq) {
    !function (w, d, t) {
      w.TiktokAnalyticsObject = t;
      const ttq = w[t] = w[t] || [];
      ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
      ttq.setAndDefer = function (target, method) {
        target[method] = function () {
          target.push([method].concat(Array.prototype.slice.call(arguments, 0)));
        };
      };
      for (let i = 0; i < ttq.methods.length; i += 1) {
        ttq.setAndDefer(ttq, ttq.methods[i]);
      }
      ttq.instance = function (id) {
        const instance = ttq._i[id] || [];
        for (let i = 0; i < ttq.methods.length; i += 1) {
          ttq.setAndDefer(instance, ttq.methods[i]);
        }
        return instance;
      };
      ttq.load = function (id, config) {
        const url = 'https://analytics.tiktok.com/i18n/pixel/events.js';
        ttq._i = ttq._i || {};
        ttq._i[id] = [];
        ttq._i[id]._u = url;
        ttq._t = ttq._t || {};
        ttq._t[id] = +new Date();
        ttq._o = ttq._o || {};
        ttq._o[id] = config || {};
        const script = d.createElement('script');
        script.type = 'text/javascript';
        script.async = true;
        script.src = `${url}?sdkid=${id}&lib=${t}`;
        const firstScript = d.getElementsByTagName('script')[0];
        firstScript.parentNode.insertBefore(script, firstScript);
      };
    }(window, document, 'ttq');
  }

  if (typeof window.ttq.grantConsent === 'function') {
    window.ttq.grantConsent();
  }
  if (typeof window.ttq.enableCookie === 'function') {
    window.ttq.enableCookie();
  }
  window.ttq.load(pixelId);
  window.__trevanoTikTokPixelInitialized = true;
}

function trackTikTokPageView() {
  if (window.ttq && !window.__trevanoTikTokInitialPageViewSent) {
    window.ttq.page();
    window.__trevanoTikTokInitialPageViewSent = true;
  }
}

function revokeMarketingConsent() {
  if (typeof window === 'undefined') return;

  if (window.fbq && window.__trevanoMetaPixelInitialized) {
    window.fbq('consent', 'revoke');
  }

  if (window.ttq && window.__trevanoTikTokPixelInitialized) {
    if (typeof window.ttq.disableCookie === 'function') {
      window.ttq.disableCookie();
    }
    if (typeof window.ttq.revokeConsent === 'function') {
      window.ttq.revokeConsent();
    }
  }
}

function subscribeToConsentChanges(callback) {
  window.addEventListener('trevano-cookie-consent', callback);
  window.addEventListener('storage', callback);

  return () => {
    window.removeEventListener('trevano-cookie-consent', callback);
    window.removeEventListener('storage', callback);
  };
}

export default function MarketingPixels() {
  const pathname = usePathname();
  const canTrack = useSyncExternalStore(subscribeToConsentChanges, hasMarketingConsent, () => false);
  const canTrackRef = useRef(canTrack);

  useEffect(() => {
    canTrackRef.current = canTrack;
    if (!canTrack) {
      revokeMarketingConsent();
    }
  }, [canTrack]);

  const isTrackableRoute = useMemo(() => {
    if (!pathname) return false;
    return !isProtectedRoute(pathname);
  }, [pathname]);

  useEffect(() => {
    if (!MARKETING_PIXELS_ENABLED) return;
    if (!canTrack || !isTrackableRoute) return;

    const metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
    const tikTokPixelId = process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID;

    if (metaPixelId) {
      initMetaPixel(metaPixelId);
      trackMetaPageView();
    }

    if (tikTokPixelId) {
      initTikTokPixel(tikTokPixelId);
      trackTikTokPageView();
    }
  }, [canTrack, isTrackableRoute, pathname]);

  useEffect(() => {
    if (!MARKETING_PIXELS_ENABLED) return undefined;

    const handleMarketingEvent = (event) => {
      if (!canTrackRef.current || !isTrackableRoute) return;

      const eventName = event?.detail?.name;
      if (!eventName) return;

      const parameters = event.detail.parameters || {};

      if (window.fbq) {
        window.fbq('trackCustom', eventName, parameters);
      }

      if (window.ttq) {
        window.ttq.track(eventName, parameters);
      }
    };

    window.addEventListener('trevano-marketing-event', handleMarketingEvent);
    return () => window.removeEventListener('trevano-marketing-event', handleMarketingEvent);
  }, [isTrackableRoute]);

  return null;
}
