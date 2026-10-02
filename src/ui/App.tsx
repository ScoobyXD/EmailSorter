/** Storage contract used only by the local preview and the Outlook demo. */
export interface DemoStorage {
  load: () => Promise<unknown>;
  save: (value: unknown) => Promise<void>;
}
