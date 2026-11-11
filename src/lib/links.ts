import { currentLang } from '../i18n';

/** Apple's standard EULA, the license this app uses in App Store Connect. */
export const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

/** Pages served by GitHub Pages from `docs/` (the same URLs go in App Store Connect). */
const SITE = 'https://gwin14.github.io/Lutra-lut-applier';

/** Privacy policy in the app's current language. */
export function privacyUrl(): string {
  return `${SITE}/${currentLang()}/privacy.html`;
}

/** Support page in the app's current language. */
export function supportUrl(): string {
  return `${SITE}/${currentLang()}/support.html`;
}
