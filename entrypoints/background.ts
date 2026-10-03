import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { GmailEngine } from '../src/gmail/engine';
import { STATE_KEY, type DockRequest } from '../src/gmail/protocol';
import type { StoredState } from '../src/gmail/model';
import { GMAIL_SIDEBAR_MIN_WIDTH, GMAIL_SIDEBAR_MAX_WIDTH, GMAIL_SIDEBAR_WIDTH_KEY, GMAIL_SIDEBAR_PREFERENCE_MESSAGE, isGmailSidebarWidth, type GmailSidebarPreferenceRequest, type GmailSidebarPreferenceResponse } from '../src/integration/gmail-sidebar-preferences';

export default defineBackground(() => {
  // Only the worker can read the stored pairing secret. Content scripts use the sanitized API.
  void browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const engine = new GmailEngine({
    async load() { return (await browser.storage.local.get(STATE_KEY))[STATE_KEY] as StoredState | undefined; },
    async save(state) { await browser.storage.local.set({ [STATE_KEY]: state }); },
    async legacy() { return (await browser.storage.local.get('dock-demo-v1'))['dock-demo-v1']; },
    async token(interactive) {
      const result = await browser.identity.getAuthToken({ interactive, enableGranularPermissions: true });
      const token = typeof result === 'string' ? result : result?.token;
      if (!token) throw new Error('Google authorization returned no access token. Reconnect Gmail.');
      if (typeof result !== 'string' && result.grantedScopes && !result.grantedScopes.includes('https://www.googleapis.com/auth/gmail.modify')) {
        await browser.identity.removeCachedAuthToken({ token });
        throw new Error('Gmail permission was not granted. Reconnect and allow gmail.modify so Dock can read messages and apply labels.');
      }
      return token;
    },
    async invalidateToken(token) { await browser.identity.removeCachedAuthToken({ token }); },
    async disconnect() { await browser.identity.clearAllCachedAuthTokens(); },
    fetch: globalThis.fetch.bind(globalThis),
    async keepAlive() { await browser.runtime.getPlatformInfo(); },
    oauthConfigured: Boolean(browser.runtime.getManifest().oauth2?.client_id),
  });
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const origin = sender.url ? new URL(sender.url).origin : '';
    if (!['https://mail.google.com', 'https://outlook.live.com', 'https://outlook.office.com', 'https://outlook.office365.com', 'https://outlook.cloud.microsoft', `chrome-extension://${browser.runtime.id}`].includes(origin)) return false;
    if (message?.type === 'dock:api') {
      void (async () => { sendResponse(await engine.handle(message as DockRequest)); })();
      return true;
    }
    if (message?.type === GMAIL_SIDEBAR_PREFERENCE_MESSAGE) {
      const respond = (response: GmailSidebarPreferenceResponse) => sendResponse(response);
      void (async () => {
        try {
          const request = message as GmailSidebarPreferenceRequest;
          switch (request.command) {
            case 'load': {
              const width: unknown = (await browser.storage.local.get(GMAIL_SIDEBAR_WIDTH_KEY))[GMAIL_SIDEBAR_WIDTH_KEY];
              return respond({ ok: true, width: isGmailSidebarWidth(width) ? width : undefined });
            }
            case 'save': {
              if (request.width !== undefined && !isGmailSidebarWidth(request.width)) {
                return respond({ ok: false, error: `Gmail sidebar width must be a whole number from ${GMAIL_SIDEBAR_MIN_WIDTH} to ${GMAIL_SIDEBAR_MAX_WIDTH} pixels.` });
              }
              if (request.width === undefined) await browser.storage.local.remove(GMAIL_SIDEBAR_WIDTH_KEY);
              else await browser.storage.local.set({ [GMAIL_SIDEBAR_WIDTH_KEY]: request.width });
              return respond({ ok: true, width: request.width });
            }
            default: return respond({ ok: false, error: 'Unknown Gmail sidebar settings command.' });
          }
        } catch {
          respond({ ok: false, error: 'Gmail sidebar settings could not be saved or loaded. Try again.' });
        }
      })();
      return true;
    }
    if (message?.type === 'dock:demo-load') {
      void (async () => { const value = await browser.storage.local.get('dock-demo-v1'); sendResponse({ value: value['dock-demo-v1'] }); })();
      return true;
    }
    if (message?.type === 'dock:demo-save') {
      void (async () => { await browser.storage.local.set({ 'dock-demo-v1': message.value }); sendResponse({ ok: true }); })();
      return true;
    }
    return false;
  });
  browser.action.onClicked.addListener(async (tab) => {
    if (typeof tab.id === 'number') {
      try {
        const result = await browser.tabs.sendMessage(tab.id, { type: 'dock:focus' });
        if (result?.ok) return;
      } catch {
        // A normal browser tab has no Dock content script.
      }
    }
    await browser.tabs.create({ url: browser.runtime.getURL('/preview.html') });
  });
});
