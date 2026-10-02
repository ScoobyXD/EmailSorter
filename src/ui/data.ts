import type { DockCategory } from '../gmail/protocol';

export interface DemoMessage {
  id: string;
  sender: string;
  subject: string;
  preview: string;
  body: string;
  categoryId: string;
  time: string;
  receivedOrder: number;
}
export interface DemoState { version: 2; categories: DockCategory[]; messages: DemoMessage[] }

export const demoCategories: DockCategory[] = [
  { id: 'customs', title: 'Customs', description: 'Customs clearance, import and export paperwork, shipment holds and duties.', icon: 'shield', color: '#fbe983' },
  { id: 'shipping', title: 'Shipping', description: 'Freight bookings, pickups, deliveries, tracking and transport arrangements.', icon: 'truck', color: '#b6cff5' },
  { id: 'purchasing', title: 'Purchase orders', description: 'Purchase orders, order confirmations, changes, approvals and lead times.', icon: 'clipboard', color: '#d0bcf1' },
  { id: 'vendors', title: 'Vendors', description: 'Supplier relationships, product quotes, pricing and vendor updates.', icon: 'factory', color: '#a0eac9' },
  { id: 'invoices', title: 'Invoices', description: 'Invoices, payment requests, billing questions and receipts.', icon: 'receipt', color: '#f6c5be' },
];

export function createInitialState(): DemoState {
  const samples = [
    ['Nina Patel', 'Shipment held — commercial invoice needed', 'Container MSKU 482910 needs a corrected invoice.', 'customs', '8:42 am'],
    ['Marcus Reed', 'Pickup moved forward to 11 am', 'Please confirm the loading dock for the outbound shipment.', 'shipping', '8:28 am'],
    ['Priya Shah', 'Revised lead time for PO-2048', 'An equivalent part is available for dispatch this week.', 'purchasing', '8:16 am'],
    ['Leo Chen', 'Q4 steel pricing — updated quote', 'Your revised quote includes the volume discount.', 'vendors', '8:05 am'],
    ['Emma Brooks', 'Invoice INV-8821 ready for review', 'The invoice for the packaging delivery is ready.', 'invoices', '7:53 am'],
    ['Owen Miller', 'Delivery appointment: Thursday, 9–11 am', 'Your inbound pallet delivery is scheduled.', 'shipping', '7:41 am'],
    ['Sofia Torres', 'Export documents for order EX-1190', 'The packing list and certificate of origin are complete.', 'customs', '7:30 am'],
    ['Daniel Park', 'PO-2036 confirmed — dispatch next week', 'Your order is confirmed, with all items available.', 'purchasing', '7:12 am'],
  ];
  return { version: 2, categories: demoCategories.map(category => ({ ...category })), messages: samples.map(([sender, subject, preview, categoryId, time], index) => ({ id: `dock-demo-${index + 1}`, sender: sender!, subject: subject!, preview: preview!, body: `Hi Alex,\n\n${preview}\n\nThanks,\n${sender}`, categoryId: categoryId!, time: time!, receivedOrder: 8 - index })) };
}

/** Keep prototype category IDs and names while replacing obsolete sample metadata. */
export function migrateDemoState(value: unknown): DemoState {
  const initial = createInitialState();
  if (!value || typeof value !== 'object' || !('categories' in value) || !Array.isArray(value.categories)) return initial;
  const seen = new Set<string>();
  const categories: DockCategory[] = [];
  for (const item of value.categories.slice(0, 50)) {
    if (!item || typeof item.id !== 'string' || seen.has(item.id)) continue;
    const title = typeof item.title === 'string' ? item.title : item.name;
    if (typeof title !== 'string' || !title.trim()) continue;
    const fallback = demoCategories.find(category => category.id === item.id);
    categories.push({ id: item.id, title: title.trim().slice(0, 64), description: typeof item.description === 'string' ? item.description : fallback?.description ?? '', icon: typeof item.icon === 'string' ? item.icon : fallback?.icon ?? 'tag', color: /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : fallback?.color ?? '#b6cff5' });
    seen.add(item.id);
  }
  return { ...initial, categories, messages: initial.messages.map(message => ({ ...message, categoryId: seen.has(message.categoryId) ? message.categoryId : 'uncategorized' })) };
}
