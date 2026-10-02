import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { GmailEngine } from '../src/gmail/engine';
import { GmailJournal } from '../src/gmail/journal';
import { STATE_KEY, type DockRequest } from '../src/gmail/protocol';
import type { StoredState } from '../src/gmail/model';

export default defineBackground(() => {
  // Only the worker can read the stored pairing secret. Content scripts use the sanitized API.
  const protectedStorage = browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const loadState = async () => {
    await protectedStorage;
    return (await browser.storage.local.get(STATE_KEY))[STATE_KEY] as StoredState | undefined;
  };
  const journal = new GmailJournal({
    async identity() { const state = await loadState(); return state ? { installationId: state.installationId, helperToken: state.helperToken } : undefined; },
    fetch: globalThis.fetch.bind(globalThis),
    extensionVersion: browser.runtime.getManifest().version,
  });
  const engine = new GmailEngine({
    load: loadState,
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
    async log(event) { await journal.append(event); },
    oauthConfigured: Boolean(browser.runtime.getManifest().oauth2?.client_id),
  });
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const origin = sender.url ? new URL(sender.url).origin : '';
    if (!['https://mail.google.com', 'https://outlook.live.com', 'https://outlook.office.com', 'https://outlook.office365.com', 'https://outlook.cloud.microsoft', `chrome-extension://${browser.runtime.id}`].includes(origin)) return false;
    if (message?.type === 'dock:api') {
      void (async () => {
        try {
          if (message.command === 'logs') {
            const logPage = await journal.page({ runId: message.runId, before: message.before, limit: message.limit });
            // Reading logs never writes events or starts email processing. It can resume an acknowledged mirror backlog.
            journal.kickMirror(); sendResponse({ ok: true, logPage });
          } else if (message.command === 'exportLogs') {
            sendResponse({ ok: true, logExport: await journal.export(message.runId) });
          } else if (message.command === 'syncLogs') {
            await journal.sync(); sendResponse({ ok: true, logPage: await journal.page() });
          } else {
            const response = await engine.handle(message as DockRequest);
            if (message.command === 'state' || message.command === 'pairHelper') journal.kickMirror();
            sendResponse(response);
          }
        } catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Diagnostic logs could not be loaded.' }); }
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
