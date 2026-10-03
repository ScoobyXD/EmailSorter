export const GMAIL_QUOTA_SOURCE = 'https://developers.google.com/workspace/gmail/api/reference/quota';
export const GMAIL_QUOTA_UNITS_PER_MINUTE = 6000;

/** Published Gmail quota costs, checked on 2026-10-02. */
export const GMAIL_QUOTA_METHODS = {
  getProfile: { label: 'Check Gmail account', units: 1 },
  'labels.list': { label: 'List labels', units: 1 },
  'labels.create': { label: 'Create labels', units: 5 },
  'labels.get': { label: 'Read labels', units: 1 },
  'labels.patch': { label: 'Update label names and colors', units: 5 },
  'labels.update': { label: 'Replace labels', units: 5 },
  'labels.delete': { label: 'Delete labels', units: 5 },
  'messages.list': { label: 'Find emails', units: 5 },
  'messages.get': { label: 'Read emails', units: 20 },
  'messages.attachments.get': { label: 'Read email body attachments', units: 20 },
  'messages.modify': { label: 'Apply category labels', units: 5 },
} as const;

export type GmailQuotaMethod = keyof typeof GMAIL_QUOTA_METHODS;

export function gmailQuotaMethod(path: string, method = 'GET'): GmailQuotaMethod {
  const resource = path.split('?')[0]!;
  const verb = method.toUpperCase();
  if (resource === 'profile' && verb === 'GET') return 'getProfile';
  if (resource === 'labels') {
    if (verb === 'GET') return 'labels.list';
    if (verb === 'POST') return 'labels.create';
  }
  if (/^labels\/[^/]+$/.test(resource)) {
    if (verb === 'GET') return 'labels.get';
    if (verb === 'PATCH') return 'labels.patch';
    if (verb === 'PUT') return 'labels.update';
    if (verb === 'DELETE') return 'labels.delete';
  }
  if (resource === 'messages' && verb === 'GET') return 'messages.list';
  if (/^messages\/[^/]+$/.test(resource) && verb === 'GET') return 'messages.get';
  if (/^messages\/[^/]+\/attachments\/[^/]+$/.test(resource) && verb === 'GET') return 'messages.attachments.get';
  if (/^messages\/[^/]+\/modify$/.test(resource) && verb === 'POST') return 'messages.modify';
  throw new Error(`Gmail quota cost is not configured for ${verb} ${resource}.`);
}
