// Tiny request-scoped localizer for user-facing server messages (errors +
// short responses that surface directly in the UI). No key registry — callers
// pass both strings inline: `msg(req, 'עברית', 'English')`.
//
// Language resolution:
//   - Authenticated routes: req.user.language (set by requireAuth).
//   - Pre-auth routes (login/register/forgot/reset): the `X-App-Lang` header the
//     client sends. On the very first register call the client drives this from
//     the sign-up form's selected language (see client api.js), so a brand-new
//     English account already gets English responses.
//   - Fallback: Hebrew (the app's original/default language).
export function reqLang(req) {
  const fromUser = req?.user?.language;
  if (fromUser === 'en' || fromUser === 'he') return fromUser;
  const header = String(req?.headers?.['x-app-lang'] || '').toLowerCase();
  return header === 'en' ? 'en' : 'he';
}

export function msg(req, he, en) {
  return reqLang(req) === 'en' ? en : he;
}

// Shared fallback labels for meal category / product unit, used when the client
// or the AI omits them. Categories are stored as display text (a user never
// switches language, so their stored labels stay in their language) — these keep
// server-side defaults in the account's language too.
export const defaultCat = (lang) => (lang === 'en' ? 'Snack / other' : 'נשנוש / ביניים');
export const defaultUnit = (lang) => (lang === 'en' ? 'serving' : 'מנה');
