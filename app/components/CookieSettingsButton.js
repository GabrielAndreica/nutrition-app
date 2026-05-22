'use client';

const STORAGE_KEY = 'trevano_cookie_consent';
const CONSENT_VERSION = 4;

export default function CookieSettingsButton({ className, children = 'Setări cookies' }) {
  const openCookieSettings = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable in private browsing modes.
    }

    window.dispatchEvent(new CustomEvent('trevano-cookie-consent', {
      detail: {
        value: 'reset',
        marketing: false,
        savedAt: new Date().toISOString(),
        version: CONSENT_VERSION,
      },
    }));
  };

  return (
    <button type="button" className={className} onClick={openCookieSettings}>
      {children}
    </button>
  );
}
