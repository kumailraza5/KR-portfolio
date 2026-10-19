/**
 * Reliable detection for iOS devices (iPhone, iPad, and iPod) across all browsers
 * (Safari, Chrome, Firefox, Edge, and in-app web views).
 *
 * Handles iPadOS 13+ devices which identify as desktop Macintosh (MacIntel)
 * by verifying multi-touch support via navigator.maxTouchPoints.
 */
export function isIOS(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const ua = navigator.userAgent || '';
  const platform =
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    '';

  // 1. Direct UA or platform check for iPhone, iPad, iPod
  const isDirectIOS = /iPhone|iPad|iPod/i.test(ua) || /iPhone|iPad|iPod/i.test(platform);
  if (isDirectIOS) {
    return true;
  }

  // 2. iPadOS 13+ desktop-class Safari / browsers reporting as Macintosh/MacIntel
  // with multi-touch capability (desktop Macs do not have touchscreen support)
  const isIPadOS =
    (/Macintosh/i.test(ua) || platform === 'MacIntel') &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1;

  if (isIPadOS) {
    return true;
  }

  // 3. Modern Client Hints platform fallback if supported
  if ((navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform === 'iOS') {
    return true;
  }

  return false;
}
