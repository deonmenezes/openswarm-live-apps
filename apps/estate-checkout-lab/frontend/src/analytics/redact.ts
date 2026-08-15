// Capture-time redaction. Every tracked value passes through here BEFORE it is
// queued, so a secret is destroyed in the browser rather than sanitised later on
// a server that already received it. The backend runs its own scrub as a second
// line of defence (backend/apps/ingest/ingest.py), but that one exists to catch a
// hand-rolled POST, not to make this file optional.

export type Policy = 'drop' | 'email' | 'name' | 'keep';

export interface Redacted {
  /** What may be transmitted. `null` means the value never leaves the browser. */
  value: string | null;
  policy: Policy;
  /** Shown in the UI so a tester can see the rule that fired, per keystroke. */
  note: string;
}

// Matched as a substring against a lowercased field name, so "billing-cardNumber"
// and "card_number" are both caught by "card". Deliberately the same token list
// as the backend's BANNED_VALUE_FIELDS: if they drift, the server wins and the
// event arrives valueless, which is the safe direction to fail in.
const NEVER_TRANSMIT = [
  'card',
  'cvv',
  'cvc',
  'password',
  'passcode',
  'ssn',
  'routing',
  'iban',
  'account',
  'secret',
  'token',
];

const EMAIL_FIELDS = ['email', 'mail'];
const NAME_FIELDS = ['name', 'fullname', 'buyer'];

export function policyFor(field: string): Policy {
  const f = field.toLowerCase();
  if (NEVER_TRANSMIT.some((token) => f.includes(token))) return 'drop';
  if (EMAIL_FIELDS.some((token) => f.includes(token))) return 'email';
  if (NAME_FIELDS.some((token) => f.includes(token))) return 'name';
  return 'keep';
}

/** j***@d***.com — enough to recognise a returning buyer, not enough to contact them. */
export function maskEmail(email: string): string {
  if (!email) return '';
  if (!email.includes('@')) return maskToken(email);
  const [local, domain = ''] = email.split('@');
  const [host, ...rest] = domain.split('.');
  const tld = rest.length ? `.${rest.join('.')}` : '';
  return `${maskToken(local)}@${maskToken(host)}${tld}`;
}

/** "Jane Quinn Doe" -> "Jane Q. D." — first name survives, the rest becomes an initial. */
export function maskName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return [parts[0], ...parts.slice(1).map((p) => `${p[0].toUpperCase()}.`)].join(' ');
}

function maskToken(token: string): string {
  if (!token) return '***';
  return `${token[0]}***`;
}

export function redact(field: string, value: string): Redacted {
  const policy = policyFor(field);
  switch (policy) {
    case 'drop':
      return {
        value: null,
        policy,
        note: `"${field}" is a secret field — the value is discarded in the browser and never sent`,
      };
    case 'email':
      return { value: maskEmail(value), policy, note: 'email masked before transmission' };
    case 'name':
      return { value: maskName(value), policy, note: 'name reduced to first name + initials' };
    default:
      return { value, policy, note: 'not sensitive — transmitted as typed' };
  }
}

/** Redact a whole form at once, for the payload attached to a submit event. */
export function redactAll(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(fields)) {
    const result = redact(field, value);
    if (result.value !== null) out[field] = result.value;
  }
  return out;
}
