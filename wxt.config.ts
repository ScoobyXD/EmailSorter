import { defineConfig } from 'wxt';
import identity from './extension-identity.json';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Dock — Gmail Categories',
    description: 'Manually categorize Gmail Inbox messages using your categories and a private local Jev helper.',
    key: identity.key,
    permissions: ['storage', 'identity'],
    host_permissions: ['https://gmail.googleapis.com/*', 'http://127.0.0.1:38471/*'],
    ...(identity.oauthClientId ? { oauth2: { client_id: identity.oauthClientId, scopes: ['https://www.googleapis.com/auth/gmail.modify'] } } : {}),
    action: { default_title: 'Show inbox filters' },
  },
});
