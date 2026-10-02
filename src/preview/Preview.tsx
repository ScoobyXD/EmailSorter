import { useState } from 'react';
import { Inbox, Star, Clock3, Send, FileText, Search, Menu, SlidersHorizontal, ChevronDown, CircleHelp, Settings, Grid3X3, X, Download, ArrowRight, Mail, Tag, Users, Info } from 'lucide-react';
import { Workspace } from '../ui/Workspace';
import { previewStorage } from '../preview-storage';

const backdropMessages = [
  ['Northstar Logistics', 'Clearance documents needed for container MSKU 4821', 'The shipment is ready for clearance. Please confirm the commercial invoice…', '8:42 AM'],
  ['Maya Chen · Apex Components', 'Updated lead time — aluminum housings', 'Hi Alex, a quick update on your latest purchase order. We can ship…', '8:25 AM'],
  ['Harbor Freight Partners', 'Booking confirmation · Oakland → Rotterdam', 'Your booking has been confirmed. Find the sailing schedule attached…', '8:12 AM'],
  ['Summit Packaging', 'Your quote for corrugated shipping boxes', 'Thanks for sending your specifications. Here is the volume pricing…', 'Yesterday'],
  ['Priya Shah · Finance', 'Invoice INV-2094 for review', 'Could you take a look at the line items before we release payment?', 'Yesterday'],
  ['Westlake Supply', 'October supplier bulletin', 'This month: new product availability and updated delivery windows…', 'Yesterday'],
];

export function Preview() {
  const [provider, setProvider] = useState<'Gmail' | 'Outlook'>('Gmail');
  const [help, setHelp] = useState(false);
  const [selected, setSelected] = useState(false);
  const [nativeTab, setNativeTab] = useState('primary');
  const [resetSelectionToken, setResetSelectionToken] = useState(0);
  const [tabsTarget, setTabsTarget] = useState<HTMLDivElement | null>(null);
  const [viewTarget, setViewTarget] = useState<HTMLDivElement | null>(null);

  function selectNative(tab: string) {
    setNativeTab(tab);
    setSelected(false);
    setResetSelectionToken(token => token + 1);
  }

  const nativeTabs = provider === 'Gmail'
    ? [{ name: 'Promotions', icon: Tag }, { name: 'Social', icon: Users }, { name: 'Updates', icon: Info }]
    : [{ name: 'Other', icon: Mail }];

  return <div className="prototype-page">
    <header className="prototype-topbar">
      <div className="prototype-wordmark"><strong>Dock</strong><span>Manual inbox categories</span></div>
      <div className="prototype-top-actions"><span className="prototype-status">Local demo</span><button className="install-help" onClick={() => setHelp(true)}><Download size={16}/>Load in your browser</button></div>
    </header>
    <main className="prototype-main">
      <div className="prototype-intro"><div><h1>Categories, inside your inbox.</h1><p>Preview the tabs with sample emails. Use + to define a category, or Edit to refine it.</p></div>
        <div className="provider-switch" aria-label="Preview email provider">{(['Gmail', 'Outlook'] as const).map(name => <button key={name} aria-label={name} aria-pressed={provider === name} onClick={() => { setProvider(name); selectNative('primary'); }}>{name === 'Gmail' ? <Mail size={16}/> : <span className="outlook-mark">O</span>}{name}</button>)}</div>
      </div>
      <div className={`mail-scene ${provider.toLowerCase()}`}>
        <div className="mail-top">
          <Menu size={22}/><div className="mail-brand"><Mail size={27}/><span>{provider}</span></div>
          <div className="mail-search"><Search size={21}/><span>Search mail</span><SlidersHorizontal size={20}/></div>
          <div className="mail-utilities"><CircleHelp size={21}/><Settings size={21}/><Grid3X3 size={21}/><span className="avatar">AK</span></div>
        </div>
        <div className="mail-workspace">
          <nav className="mail-nav" aria-label="Illustrative mailbox navigation">
            <div className="compose-look"><Mail size={20}/>Compose</div><div className="mail-nav-row selected"><Inbox size={18}/>Inbox<span>12</span></div><div className="mail-nav-row"><Star size={18}/>Starred</div><div className="mail-nav-row"><Clock3 size={18}/>Snoozed</div><div className="mail-nav-row"><Send size={18}/>Sent</div><div className="mail-nav-row"><FileText size={18}/>Drafts<span>2</span></div><div className="mail-nav-label">Labels</div><div className="mail-nav-row"><span className="label-dot"/>Operations</div><div className="mail-nav-row"><span className="label-dot"/>Follow up</div><div className="mock-note">Illustrative mailbox<br/>Sample messages only</div>
          </nav>
          <div className="mail-content">
            <div className="mail-list-tools"><span className="mail-check"/><ChevronDown size={14}/><span className="refresh-look">↻</span><span className="mail-count">Sample inbox</span></div>
            <div className="mail-category-row" aria-label={`${provider} inbox categories`}>
              <button role="tab" aria-selected={!selected && nativeTab === 'primary'} className="mail-native-tab" onClick={() => selectNative('primary')}><Inbox size={20}/><span>{provider === 'Gmail' ? 'Primary' : 'Focused'}</span></button>
              {nativeTabs.map(({ name, icon: Icon }) => <button key={name} role="tab" aria-selected={!selected && nativeTab === name} className="mail-native-tab" onClick={() => selectNative(name)}><Icon size={20}/><span>{name}</span></button>)}
              <div className="mail-custom-tabs" ref={setTabsTarget}/>
            </div>
            <div className="mail-reading-area">
              <div className="mail-backdrop" style={{ display: selected ? 'none' : undefined }} aria-label={`Illustrative ${provider} inbox; sample content`}>
                <div className="mail-list">
                  {backdropMessages.map(([sender,subject,excerpt,time],i) => <div className={`mail-row ${i < 3 ? 'unread' : ''}`} key={subject}><span className="mail-check"/><Star size={17}/><strong>{sender}</strong><div className="mail-row-summary"><span>{subject}</span><span className="mail-row-excerpt"> — {excerpt}</span></div><time>{time}</time></div>)}
                  <p className="mail-hint">This is a sample mailbox. Select a custom category above to explore the demo.</p>
                </div>
              </div>
              <div className="mail-category-view" ref={setViewTarget} style={{ display: selected ? undefined : 'none' }}/>
            </div>
          </div>
        </div>
      </div>
      <Workspace mode={provider === 'Outlook' ? 'outlook' : 'preview'} storage={previewStorage} tabsTarget={tabsTarget} viewTarget={viewTarget} onSelectionChange={setSelected} resetSelectionToken={resetSelectionToken}/>
      <footer className="prototype-footnote">Demo messages only · Changes stay in this browser</footer>
    </main>
    {help && <div className="install-backdrop" onClick={() => setHelp(false)}><section role="dialog" aria-modal="true" aria-labelledby="install-title" className="install-dialog" onClick={event => event.stopPropagation()}><button className="install-close" aria-label="Close installation instructions" onClick={() => setHelp(false)}><X size={20}/></button><h2 id="install-title">Use Dock with Gmail</h2><p>This page is a sample preview. The delivered extension can categorize real Gmail messages after local setup.</p><ol><li>Follow <strong>INSTALL.md</strong> to configure and start the local helper.</li><li>Open <code>chrome://extensions</code>, enable <strong>Developer mode</strong>, and load the delivered <strong>dock-extension</strong> folder.</li><li>Refresh Gmail and choose <strong>Connect Gmail</strong> to pair the helper and authorize Gmail.</li><li>Review the category descriptions and days slider, then press <strong>Categorize emails</strong>.</li></ol><div className="install-note">The Gmail version uses colored Gmail labels and keeps your emails in place. Outlook remains a sample demo with no account connection.</div><button className="install-done" onClick={() => setHelp(false)}>Got it <ArrowRight size={17}/></button></section></div>}
  </div>;
}
