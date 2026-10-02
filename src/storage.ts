import { browser } from 'wxt/browser';
import type { DemoStorage } from './ui/data';
import { GMAIL_SIDEBAR_PREFERENCE_MESSAGE, isGmailSidebarWidth, type GmailSidebarPreferenceRequest, type GmailSidebarPreferenceResponse } from './integration/gmail-sidebar-preferences';

export const extensionStorage: DemoStorage = {
  async load(): Promise<unknown> {
    const response = await browser.runtime.sendMessage({ type: 'dock:demo-load' });
    return response?.value;
  },
  async save(value: unknown): Promise<void> {
    await browser.runtime.sendMessage({ type: 'dock:demo-save', value });
  },
};

async function sidebarPreference(request: GmailSidebarPreferenceRequest): Promise<number | undefined> {
  const response: GmailSidebarPreferenceResponse | undefined = await browser.runtime.sendMessage(request);
  if (!response) throw new Error('Gmail sidebar settings are unavailable. Reload Gmail and try again.');
  if (!response.ok) throw new Error(response.error);
  if (response.width !== undefined && !isGmailSidebarWidth(response.width)) throw new Error('The saved Gmail sidebar width is invalid.');
  return response.width;
}

export const gmailSidebarStorage = {
  async load(): Promise<number | undefined> {
    return await sidebarPreference({ type: GMAIL_SIDEBAR_PREFERENCE_MESSAGE, command: 'load' });
  },
  async save(width: number | undefined): Promise<void> {
    await sidebarPreference({ type: GMAIL_SIDEBAR_PREFERENCE_MESSAGE, command: 'save', width });
  },
};

