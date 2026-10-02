import type { DockCategory } from '../gmail/protocol';
import { COLORS, createDefaultCategories } from '../gmail/model';

/** Storage used only by the local preview and the Outlook demo. */
export interface DemoStorage {
  load: () => Promise<unknown>;
  save: (value: unknown) => Promise<void>;
}

export interface DemoState { version: 2; categories: DockCategory[] }

const samples = [
  ['Nina Patel', 'Shipment held — commercial invoice needed', 'Container MSKU 482910 needs a corrected invoice.', 'customs', '8:42 am'],
  ['Marcus Reed', 'Pickup moved forward to 11 am', 'Please confirm the loading dock for the outbound shipment.', 'shipping', '8:28 am'],
  ['Priya Shah', 'Revised lead time for PO-2048', 'An equivalent part is available for dispatch this week.', 'purchasing', '8:16 am'],
  ['Leo Chen', 'Q4 steel pricing — updated quote', 'Your revised quote includes the volume discount.', 'vendors', '8:05 am'],
  ['Emma Brooks', 'Invoice INV-8821 ready for review', 'The invoice for the packaging delivery is ready.', 'invoices', '7:53 am'],
  ['Owen Miller', 'Delivery appointment: Thursday, 9–11 am', 'Your inbound pallet delivery is scheduled.', 'shipping', '7:41 am'],
  ['Sofia Torres', 'Export documents for order EX-1190', 'The packing list and certificate of origin are complete.', 'customs', '7:30 am'],
  ['Daniel Park', 'PO-2036 confirmed — dispatch next week', 'Your order is confirmed, with all items available.', 'purchasing', '7:12 am'],
] as const;
export const sampleMessages = samples.map(([sender, subject, preview, categoryId, time], index) => ({ id: `dock-demo-${index + 1}`, sender, subject, preview, body: `Hi Alex,\n\n${preview}\n\nThanks,\n${sender}`, categoryId, time, receivedOrder: samples.length - index } as const));

export function createInitialState(): DemoState {
  return { version: 2, categories: createDefaultCategories() };
}

/** Keep prototype category IDs and names. Ignore obsolete sample metadata. */
export function migrateDemoState(value: unknown): DemoState {
  if (!value || typeof value !== 'object' || !('categories' in value) || !Array.isArray(value.categories)) return createInitialState();
  const seen = new Set<string>();
  const categories: DockCategory[] = [];
  for (const item of value.categories.slice(0, 50)) {
    if (!item || typeof item.id !== 'string' || seen.has(item.id)) continue;
    const title = typeof item.title === 'string' ? item.title : item.name;
    if (typeof title !== 'string' || !title.trim()) continue;
    categories.push({ id: item.id, title: title.trim().slice(0, 64), description: typeof item.description === 'string' ? item.description : '', icon: typeof item.icon === 'string' ? item.icon : 'tag', color: /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : COLORS[categories.length % COLORS.length]! });
    seen.add(item.id);
  }
  return { version: 2, categories };
}
