import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { Workspace, type DockApi } from '../../src/ui/Workspace';
import { attachGmailLayout } from '../../src/integration/gmail-layout';
import { attachGmailSidebar } from '../../src/integration/gmail-sidebar';
import { attachOutlookLayout, type OutlookViewRect } from '../../src/integration/outlook-layout';
import { extensionStorage, gmailSidebarStorage } from '../../src/storage';
import './shell.css';

const gmailApi: DockApi = async (request) => await browser.runtime.sendMessage(request);
const isGmail = location.hostname === 'mail.google.com';

function ExtensionShell({ tabsHost, tabsTarget, controlsHost, controlsTarget }: { tabsHost: HTMLElement; tabsTarget: HTMLElement; controlsHost: HTMLElement; controlsTarget: HTMLElement }) {
  const [active, setActive] = useState(false);
  const [viewRect, setViewRect] = useState<OutlookViewRect | null>(null);
  const [viewTarget, setViewTarget] = useState<HTMLDivElement | null>(null);
  const [resetSelectionToken, setResetSelectionToken] = useState(0);
  const resetSelection = useCallback(() => {
    setActive(false);
    setResetSelectionToken((value) => value + 1);
  }, []);

  useEffect(() => {
    return isGmail
      ? attachGmailLayout({ tabsHost, controlsHost, onNativeSelect: resetSelection })
      : attachOutlookLayout({ tabsHost, onViewRect: setViewRect, onNativeSelect: resetSelection });
  }, [tabsHost, controlsHost, resetSelection]);

  useEffect(() => {
    if (isGmail) return attachGmailSidebar(gmailSidebarStorage);
  }, []);

  useEffect(() => {
    const listener = (message: unknown, _sender: unknown, respond: (response: unknown) => void) => {
      if (message && typeof message === 'object' && 'type' in message && message.type === 'dock:focus') {
        const tab = tabsTarget.querySelector<HTMLButtonElement>('[role="tab"]');
        if (tabsHost.isConnected && tab) {
          tabsHost.scrollIntoView({ block: 'nearest' });
          tab.focus();
          respond({ ok: true });
        } else respond({ ok: false });
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [tabsHost, tabsTarget]);

  return <>
    {!isGmail && <div ref={setViewTarget} className="dock-inbox-view" hidden={!active || !viewRect} style={viewRect ?? undefined} />}
    <Workspace mode={isGmail ? 'gmail' : 'outlook'} api={isGmail ? gmailApi : undefined} storage={isGmail ? undefined : extensionStorage} tabsTarget={tabsTarget} controlsTarget={isGmail ? controlsTarget : tabsTarget} viewTarget={viewTarget} onSelectionChange={setActive} resetSelectionToken={resetSelectionToken} />
  </>;
}

export default defineContentScript({
  matches: [
    'https://mail.google.com/*', 'https://outlook.office.com/*',
    'https://outlook.office365.com/*', 'https://outlook.live.com/*',
    'https://outlook.cloud.microsoft/*',
  ],
  cssInjectionMode: 'ui', runAt: 'document_idle',
  async main(ctx) {
    const tabsHost = document.createElement('dock-inbox-tabs');
    const shadow = tabsHost.attachShadow({ mode: 'open' });
    const tabsTarget = document.createElement('div');
    Object.assign(tabsTarget.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', alignContent: 'flex-start', minWidth: '0', width: '100%' });
    shadow.append(tabsTarget);
    const controlsHost = document.createElement('dock-inbox-controls');
    const controlsShadow = controlsHost.attachShadow({ mode: 'open' });
    const controlsTarget = document.createElement('div');
    controlsShadow.append(controlsTarget);
    const isolatedEvents = ['click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress'];
    for (const root of [shadow, controlsShadow]) {
      // Let controls handle input before Gmail can cancel focus or native selects.
      for (const type of isolatedEvents) {
        root.addEventListener(type, (event) => event.stopPropagation());
      }
    }
    ctx.onInvalidated(() => { tabsHost.remove(); controlsHost.remove(); });
    const ui = await createShadowRootUi(ctx, {
      name: 'dock-inbox-prototype', position: 'inline', anchor: 'body',
      isolateEvents: isolatedEvents,
      onMount(container) {
        const element = document.createElement('div');
        container.append(element);
        const root = createRoot(element);
        root.render(<ExtensionShell tabsHost={tabsHost} tabsTarget={tabsTarget} controlsHost={controlsHost} controlsTarget={controlsTarget} />);
        return root;
      },
      onRemove(root) { root?.unmount(); },
    });
    ui.mount();
  },
});
