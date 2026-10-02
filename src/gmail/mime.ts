export interface MimePart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: MimePart[];
}
export interface GmailFullMessage {
  id: string;
  threadId: string;
  internalDate: string;
  labelIds?: string[];
  snippet?: string;
  payload?: MimePart;
}
export function header(part: MimePart | undefined, name: string): string {
  return part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}
export function decodeBase64Url(data: string, charset = 'utf-8'): string {
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  try { return new TextDecoder(charset).decode(bytes); }
  catch { return new TextDecoder().decode(bytes); }
}
export function htmlToText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:br\b[^>]*|\/p|\/div|\/li|\/tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
      const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (entity.startsWith('#')) {
        const number = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
      }
      return names[entity.toLowerCase()] || match;
    }).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}
/** Reads text MIME bodies, including Gmail's externalized body data, but never file attachments. */
export async function decodedBody(part: MimePart | undefined, getAttachment: (id: string) => Promise<string>): Promise<string> {
  if (!part) return '';
  if (part.filename || /\battachment\b/i.test(header(part, 'Content-Disposition'))) return '';
  if (part.parts?.length) {
    if (part.mimeType === 'multipart/alternative') {
      const ordered = [...part.parts].sort((a, b) => Number(b.mimeType === 'text/plain') - Number(a.mimeType === 'text/plain'));
      for (const child of ordered) {
        const text = await decodedBody(child, getAttachment);
        if (text) return text;
      }
      return '';
    }
    const values: { type: string; text: string }[] = [];
    for (const child of part.parts) values.push({ type: child.mimeType || '', text: await decodedBody(child, getAttachment) });
    return values.map((value) => value.text).filter(Boolean).join('\n\n');
  }
  if (part.mimeType !== 'text/plain' && part.mimeType !== 'text/html') return '';
  if ((part.body?.size || 0) > 240_000) throw new Error('Email body is too large for this prototype (60,000 text characters).');
  const data = part.body?.data || (part.body?.attachmentId ? await getAttachment(part.body.attachmentId) : '');
  const charset = header(part, 'Content-Type').match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || 'utf-8';
  const text = decodeBase64Url(data, charset);
  return part.mimeType === 'text/html' ? htmlToText(text) : text;
}
