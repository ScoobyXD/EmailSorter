/** Only reuse Gmail's current document when it belongs to Dock's connected account. */
export function canOpenGmailConversationInPlace(accountEmail: string | undefined): boolean {
  const current = new URL(window.location.href);
  if (current.origin !== 'https://mail.google.com' || !accountEmail) return false;

  // The account badge identifies numeric slots such as /mail/u/0/. Read it at
  // click time; the slot itself does not identify the OAuth-connected account.
  const badgeEmails = new Set<string>();
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="https://accounts.google.com/SignOutOptions"]')) {
    const url = new URL(link.href);
    if (url.hostname !== 'accounts.google.com' || url.pathname !== '/SignOutOptions') continue;
    const label = `${link.getAttribute('aria-label') ?? ''} ${link.getAttribute('title') ?? ''}`;
    for (const email of label.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []) {
      badgeEmails.add(email.toLowerCase());
    }
  }
  const expected = accountEmail.trim().toLowerCase();
  if (badgeEmails.size) return badgeEmails.size === 1 && badgeEmails.has(expected);

  // Email-valued authuser can identify the account without a badge. Unknown
  // accounts retain the account-qualified link rather than opening wrong mail.
  const authuser = current.searchParams.get('authuser');
  return !!authuser?.includes('@') && authuser.trim().toLowerCase() === expected;
}
