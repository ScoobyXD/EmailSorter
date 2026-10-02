import { useState } from 'react';
import type { DockState, RunProgress } from '../gmail/protocol';
import { GMAIL_QUOTA_METHODS, GMAIL_QUOTA_SOURCE } from '../gmail/quota';

const statusLabels: Record<RunProgress['status'], string> = {
  running: 'Running', stopping: 'Stopping', paused: 'Stopped', completed: 'Completed', failed: 'Interrupted',
};
const formatNumber = (value: number) => value.toLocaleString();
const formatDate = (value: number) => new Date(value).toLocaleString();

export function GmailUsage({ run, runHistory, onClose }: Pick<DockState, 'run' | 'runHistory'> & { onClose: () => void }) {
  const runs = [...(run ? [run] : []), ...(runHistory ?? []).filter(previous => previous.id !== run?.id)];
  const [selectedId, setSelectedId] = useState(run?.id ?? runs[0]?.id ?? '');
  const selected = runs.find(item => item.id === selectedId) ?? runs[0];
  const usage = selected?.gmailUsage;
  const totals = usage?.methods.reduce((sum, entry) => ({
    units: sum.units + entry.requests * entry.unitsPerRequest,
    requests: sum.requests + entry.requests,
    retries: sum.retries + entry.retries,
    succeeded: sum.succeeded + entry.succeeded,
    httpErrors: sum.httpErrors + entry.httpErrors,
    networkErrors: sum.networkErrors + entry.networkErrors,
  }), { units: 0, requests: 0, retries: 0, succeeded: 0, httpErrors: 0, networkErrors: 0 });

  return <>
    <h2 id="dock-dialog-title">Gmail usage</h2>
    {selected ? <>
      <label htmlFor="dock-usage-run">Run<select id="dock-usage-run" value={selected.id} onChange={event => setSelectedId(event.target.value)}>
        {runs.map(item => <option key={item.id} value={item.id}>{item.id === run?.id ? 'Current run' : 'Previous run'} · {formatDate(item.startedAt)} · {statusLabels[item.status]}</option>)}
      </select></label>
      <dl className="dock-usage-meta">
        <div><dt>Started</dt><dd><time dateTime={new Date(selected.startedAt).toISOString()}>{formatDate(selected.startedAt)}</time></dd></div>
        <div><dt>Status</dt><dd>{statusLabels[selected.status]}</dd></div>
        <div><dt>Account</dt><dd>{selected.accountEmail ?? 'Not recorded'}</dd></div>
      </dl>
      {usage && totals ? <>
        {!usage.complete && <p className="dock-notice">Partial tracking since {formatDate(usage.startedAt)}. Earlier requests are excluded.</p>}
        <dl className="dock-usage-summary">
          <div><dt>Estimated quota units</dt><dd>{formatNumber(totals.units)}</dd></div>
          <div><dt>Request attempts</dt><dd>{formatNumber(totals.requests)}</dd></div>
          <div><dt>Retries included</dt><dd>{formatNumber(totals.retries)}</dd></div>
        </dl>
        <p className="dock-field-help">{formatNumber(totals.succeeded)} succeeded · {formatNumber(totals.httpErrors)} HTTP errors · {formatNumber(totals.requests - totals.succeeded - totals.httpErrors)} with no response ({formatNumber(totals.networkErrors)} network errors)</p>
        {usage.methods.length ? <div className="dock-usage-table-scroll" tabIndex={0} role="region" aria-label="Gmail quota units by operation" aria-describedby="dock-usage-requests-note">
          <table className="dock-usage-table">
            <caption>Gmail quota units by operation</caption>
            <thead><tr><th scope="col">Operation</th><th scope="col">Requests</th><th scope="col">Retries</th><th scope="col">HTTP errors</th><th scope="col">No response</th><th scope="col">Units / request</th><th scope="col">Estimated units</th></tr></thead>
            <tbody>{usage.methods.map(entry => <tr key={entry.method}>
              <th scope="row">{GMAIL_QUOTA_METHODS[entry.method].label}<code>{entry.method}</code></th>
              <td>{formatNumber(entry.requests)}</td>
              <td>{formatNumber(entry.retries)}</td>
              <td>{formatNumber(entry.httpErrors)}</td>
              <td>{formatNumber(entry.requests - entry.succeeded - entry.httpErrors)}<small>{formatNumber(entry.networkErrors)} network errors</small></td>
              <td>{formatNumber(entry.unitsPerRequest)}</td>
              <td>{formatNumber(entry.requests * entry.unitsPerRequest)}</td>
            </tr>)}</tbody>
            <tfoot><tr><th scope="row">Total</th><td>{formatNumber(totals.requests)}</td><td>{formatNumber(totals.retries)}</td><td>{formatNumber(totals.httpErrors)}</td><td>{formatNumber(totals.requests - totals.succeeded - totals.httpErrors)}</td><td>—</td><td>{formatNumber(totals.units)}</td></tr></tfoot>
          </table>
        </div> : <p>No Gmail requests recorded yet.</p>}
        <p id="dock-usage-requests-note" className="dock-field-help">Requests include retries. Retries count automatic retries, not manual resumes. No response includes network errors and requests still pending or interrupted.</p>
        <p className="dock-field-help">Estimates use the stored quota cost for each tracked attempt, including retries and errors. Google's actual quota usage may differ. <a href={GMAIL_QUOTA_SOURCE} target="_blank" rel="noreferrer">Google's quota costs</a></p>
      </> : <p>Gmail usage is unavailable for this run.</p>}
    </> : <p>No runs yet. Start a run to record Gmail usage.</p>}
    {!!runs.length && <p className="dock-field-help">The latest 20 previous runs are saved on this browser.</p>}
    <div className="dock-dialog-actions"><button type="button" className="dock-button" onClick={onClose}>Done</button></div>
  </>;
}
