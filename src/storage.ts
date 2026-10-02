import { browser } from 'wxt/browser';

export const extensionStorage = {
  async load(): Promise<unknown> {
    const response = await browser.runtime.sendMessage({ type: 'dock:demo-load' });
    return response?.value;
  },
  async save(value: unknown): Promise<void> {
    await browser.runtime.sendMessage({ type: 'dock:demo-save', value });
  },
};

