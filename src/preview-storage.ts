const KEY = 'dock-preview-v1';
export const previewStorage = {
  async load(): Promise<unknown> {
    try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); }
    catch { return null; }
  },
  async save(value: unknown): Promise<void> {
    localStorage.setItem(KEY, JSON.stringify(value));
  },
};
