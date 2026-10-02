export const GMAIL_SIDEBAR_MIN_WIDTH = 180;
export const GMAIL_SIDEBAR_MAX_WIDTH = 600;
export const GMAIL_SIDEBAR_WIDTH_KEY = 'dock-gmail-sidebar-width';
export const GMAIL_SIDEBAR_PREFERENCE_MESSAGE = 'dock:gmail-sidebar-width';

export type GmailSidebarPreferenceRequest = { type: typeof GMAIL_SIDEBAR_PREFERENCE_MESSAGE } & (
  | { command: 'load' }
  | { command: 'save'; width?: number }
);

export type GmailSidebarPreferenceResponse =
  | { ok: true; width?: number }
  | { ok: false; error: string };

export function isGmailSidebarWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) &&
    value >= GMAIL_SIDEBAR_MIN_WIDTH && value <= GMAIL_SIDEBAR_MAX_WIDTH;
}
