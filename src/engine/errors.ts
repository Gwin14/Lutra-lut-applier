import { tr } from '../i18n';

/**
 * The WebView engine reports known failures as coded messages
 * ('@code|arg|arg'); anything else (e.g. a browser/codec error) passes through.
 */
export function localizeEngineError(message: string | null | undefined): string {
  if (!message || !message.startsWith('@')) return message ?? tr().exports.unknownFailure;
  const [code, ...args] = message.slice(1).split('|');
  const t = tr().engineErrors;
  switch (code) {
    case 'noWebgl':
      return t.noWebgl;
    case 'noVideoTrack':
      return t.noVideoTrack;
    case 'cannotDecode':
      return t.cannotDecode(args[0] || null);
    case 'noEncoder':
      return t.noEncoder(args[0] ?? '', args[1] ?? '');
    default:
      return message;
  }
}
