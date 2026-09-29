import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowUpRight, ChartNoAxesCombined } from 'lucide-react';
import type { CompilationDetail, DomainProfile, SavedScreen } from '@workspace/api-client-react';

const colors = ['#c85d3c', '#347c77', '#9a7431', '#786597', '#477d41', '#ac5974', '#607a9b', '#916e52'];
const periodColors = ['#477a70', '#9a7143', '#816785', '#668044', '#ae6957', '#627b99'];
const number = (value: number) => new Intl.NumberFormat('en-US').format(Math.round(value));
const short = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const valid = (value: number) => Number.isFinite(value) && value >= 0;
// Duplicate month rows are ambiguous. Suppress them in every representation.
const monthValues = (profile: DomainProfile) => {
  const counts = new Map<string, number>();
  for (const point of profile.monthlyVisits) counts.set(point.month, (counts.get(point.month) ?? 0) + 1);
  return new Map(profile.monthlyVisits
    .filter(point => counts.get(point.month) === 1 && valid(point.visits))
    .map(point => [point.month, point.visits]));
};
const monthIndex = (month: string) => {
  const match = /^(\d{4})-(0?[1-9]|1[0-2])(?:$|-)/.exec(month);
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
};
const consecutive = (previous: string, next: string) => {
  const a = monthIndex(previous), b = monthIndex(next);
  return a !== null && b !== null && b - a === 1;
};
const link = (url: string) => { try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; } };
const profilesOf = (screen: SavedScreen): DomainProfile[] => [screen.report.target, ...(screen.report.comparison ? [screen.report.comparison] : []), ...(screen.report.additionalProfiles ?? [])];

export function EvidenceAtlas({ compilation, activeAnswer }: { compilation: CompilationDetail; activeAnswer: {id:string; reportIds:string[]} | null }) {
  const [selectedReport, setSelectedReport] = useState(0);
  const [hidden, setHidden] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const cited = (item: SavedScreen) => !!activeAnswer?.reportIds.some(reportId => reportId === item.id || reportId === item.report.id);
  const firstCitedIndex = compilation.screens.findIndex(cited);
  const periods = [...new Set(compilation.screens.map(item => item.report.period || 'Period not supplied'))];
  function openReport(index: number) {
    setSelectedReport(index);
    setHidden([]);
    setSelectedMonth(null);
    document.getElementById(`atlas-tab-${index}`)?.focus();
  }
  useEffect(() => {
    if (!activeAnswer || firstCitedIndex < 0) return;
    setSelectedReport(firstCitedIndex);
    setHidden([]);
    setSelectedMonth(null);
    // Move keyboard focus to the opened report so the result of the command is apparent.
    document.getElementById(`atlas-tab-${firstCitedIndex}`)?.focus();
  }, [activeAnswer?.id, firstCitedIndex]);
  const screen = compilation.screens[selectedReport];
  const profiles = screen ? profilesOf(screen) : [];
  const series = new Map(profiles.map(profile => [profile, monthValues(profile)]));
  // Retain months with invalid/missing estimates so the table can name the gap.
  const months = [...new Set(profiles.flatMap(profile => profile.monthlyVisits.map(point => point.month).filter(Boolean)))].sort();
  const hasValues = profiles.some(profile => (series.get(profile)?.size ?? 0) > 0);
  const activeMonth = selectedMonth && months.includes(selectedMonth) ? selectedMonth : months[months.length - 1];
  const visible = profiles.filter(profile => !hidden.includes(profile.domain));
  const max = Math.max(0, ...visible.flatMap(profile => [...(series.get(profile)?.values() ?? [])]));
  const axisMax = max || 1;
  const left = 67, right = 18, top = 25, bottom = 216, width = 740;
  const x = (index: number) => left + index * (width - left - right) / Math.max(1, months.length - 1);
  const y = (visits: number) => bottom - visits / axisMax * (bottom - top);
  const paths = (profile: DomainProfile) => {
    const entries = series.get(profile) ?? new Map<string, number>();
    const sections: string[] = [];
    let current: string[] = [];
    months.forEach((month, index) => {
      const value = entries.get(month);
      if (value === undefined) {
        if (current.length) sections.push(current.join(' '));
        current = [];
      } else {
        if (current.length && !consecutive(months[index - 1], month)) {
          sections.push(current.join(' '));
          current = [];
        }
        current.push(`${current.length ? 'L' : 'M'} ${x(index)} ${y(value)}`);
      }
    });
    if (current.length) sections.push(current.join(' '));
    return { entries, sections };
  };
  return <section className="atlas" aria-labelledby="atlas-title" data-testid="section-evidence-atlas">
    <div className="atlas-head"><div><span className="dl-eyebrow">Evidence atlas / Saved report data</span><h2 id="atlas-title">Follow the evidence.</h2><p>Explore monthly visit estimates, then trace the source and the next question for a seller. Each view stays inside one report and its own period.</p></div><span className="atlas-count" data-testid="text-atlas-report-count">{compilation.screens.length} source {compilation.screens.length === 1 ? 'report' : 'reports'}</span></div>
    {compilation.screens.length > 0 && <div className="atlas-overview" aria-labelledby="atlas-overview-title">
      <div className="atlas-overview-heading"><div><span className="dl-eyebrow">01 / Entire research set</span><h3 id="atlas-overview-title">One set. Separate windows.</h3></div><p>Every tile is one saved report. Figures belong to that report's period only; they are not added or ranked across windows. Open a tile to inspect its monthly evidence.</p></div>
      <div className="atlas-period-groups">{periods.map((period, periodIndex) => <section className="atlas-period-group" key={period} style={{'--period-color':periodColors[periodIndex % periodColors.length]} as React.CSSProperties} aria-label={`Reports for ${period}`}>
        <div className="atlas-period-heading"><span className="atlas-period-marker" aria-hidden="true"/><strong>{period}</strong><small>Separate reporting window · {compilation.screens.filter(item => (item.report.period || 'Period not supplied') === period).length} {compilation.screens.filter(item => (item.report.period || 'Period not supplied') === period).length === 1 ? 'report' : 'reports'}</small></div>
        <div className="atlas-overview-list">{compilation.screens.map((item, index) => {
          if ((item.report.period || 'Period not supplied') !== period) return null;
          const followUps = new Set([...item.report.sellerQuestions, ...item.report.findings.map(finding => finding.verificationQuestion).filter(Boolean)]).size;
          return <button key={item.id} type="button" className="atlas-overview-card" aria-label={`Open report for ${item.targetDomain}, ${period}. Average monthly visits ${valid(item.report.target.averageVisits) ? number(item.report.target.averageVisits) : 'not reported'}. ${followUps} seller follow-ups.`} onClick={() => openReport(index)} data-testid={`button-atlas-overview-${item.id}`}>
            <span className="atlas-overview-card-top"><span>Report {String(index + 1).padStart(2,'0')}</span>{cited(item) && <span className="atlas-overview-cited">Cited in selected answer</span>}<ArrowUpRight size={16} aria-hidden="true"/></span>
            <strong>{item.targetDomain}</strong>
            <span className="atlas-overview-metrics"><span><b>{valid(item.report.target.averageVisits) ? short(item.report.target.averageVisits) : 'Not reported'}</b><small>Target average visits / month</small></span><span><b>{followUps}</b><small>Saved seller follow-ups</small></span></span>
          </button>;
        })}</div>
      </section>)}</div>
    </div>}
    {!screen ? <div className="atlas-main"><h3>No source reports available</h3><p>There is no saved visit data to chart. The compilation summary can still be read above.</p></div> : <div className="atlas-body">
      <div className="atlas-main">
        <div className="atlas-tabs" role="tablist" aria-label="Saved report to explore">{compilation.screens.map((item, index) => <button key={item.id} type="button" role="tab" aria-selected={selectedReport === index} aria-controls="atlas-report-panel" id={`atlas-tab-${index}`} tabIndex={selectedReport === index ? 0 : -1} onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End') { event.preventDefault(); const count = compilation.screens.length; const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (selectedReport + (event.key === 'ArrowRight' ? 1 : -1) + count) % count; setSelectedReport(next); setHidden([]); setSelectedMonth(null); const target = document.getElementById(`atlas-tab-${next}`); target?.focus(); } }} onClick={() => {setSelectedReport(index);setHidden([]);setSelectedMonth(null);}} data-testid={`button-atlas-report-${item.id}`}>0{index + 1} / {item.targetDomain}{cited(item) && <span className="atlas-cited">Cited</span>}</button>)}</div>
        {activeAnswer && <p className="atlas-answer-status" role="status" data-testid="status-atlas-active-answer">{firstCitedIndex >= 0 ? `Selected answer: ${compilation.screens.filter(cited).length} cited saved ${compilation.screens.filter(cited).length === 1 ? 'report' : 'reports'} marked above. First cited report opened.` : 'Selected answer has no cited saved reports in this compilation.'}</p>}
        <div id="atlas-report-panel" role="tabpanel" aria-labelledby={`atlas-tab-${selectedReport}`}>
          <div className="atlas-label"><h3>{screen.targetDomain}{profiles.length > 1 ? ` + ${profiles.length - 1} ${profiles.length === 2 ? 'peer' : 'peers'}` : ''}</h3><span data-testid="text-atlas-period">{screen.report.period || 'Period not supplied'}</span></div>
          <p className="atlas-meta">Report saved {new Date(screen.createdAt).toLocaleDateString()} · Source generated {new Date(screen.report.generatedAt).toLocaleDateString()} · Estimated visits, not verified sales</p>
          <div className="atlas-key" aria-label="Companies displayed">
            {profiles.map((profile, index) => <button key={`${screen.id}-${profile.domain}`} type="button" aria-pressed={!hidden.includes(profile.domain)} onClick={() => setHidden(previous => previous.includes(profile.domain) ? previous.filter(domain => domain !== profile.domain) : [...previous, profile.domain])} data-testid={`button-atlas-company-${index}`}><span className="atlas-swatch" style={{'--series-color':colors[index % colors.length]} as React.CSSProperties}/>{profile.domain}</button>)}
          </div>
          {!visible.length && <p className="desk-note" role="status">All company lines are hidden. Select a company above to show its trend again; the values remain in the table.</p>}
          {months.length ? <>
            {hasValues ? <div className="atlas-plot">
              <svg viewBox="0 0 740 262" role="img" aria-label={`Monthly estimated visits for ${visible.length} selected companies in ${screen.report.period}. Numeric values and missing data appear in the table below.`}>
                {[0,.5,1].map(fraction => <g key={fraction}><line x1={left} x2={width-right} y1={y(axisMax * fraction)} y2={y(axisMax * fraction)} stroke="#dce6d8" strokeDasharray={fraction ? '4 5' : undefined}/><text x={left - 11} y={y(axisMax * fraction) + 4} textAnchor="end" fontSize="11" fill="#718675" fontFamily="IBM Plex Mono, monospace">{short(axisMax * fraction)}</text></g>)}
                {months.map((month, index) => <text key={month} x={x(index)} y="245" textAnchor="middle" fontSize="10" fill={month === activeMonth ? '#233f2c' : '#738576'} fontFamily="IBM Plex Mono, monospace">{month}</text>)}
                {visible.map(profile => { const index = profiles.indexOf(profile); const plotted = paths(profile); return <g key={profile.domain}>{plotted.sections.map((path, part) => <path key={part} d={path} fill="none" stroke={colors[index % colors.length]} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>)}{months.map((month, pointIndex) => {const value = plotted.entries.get(month); return value === undefined ? null : <circle key={month} cx={x(pointIndex)} cy={y(value)} r={month === activeMonth ? 5.5 : 3} fill={colors[index % colors.length]} stroke="#fcfcf6" strokeWidth="2"/>;})}</g>; })}
              </svg>
            </div> : <div className="desk-empty"><ChartNoAxesCombined size={26} aria-hidden="true"/><h3>No unambiguous monthly values.</h3><p>Missing and duplicate month values cannot be plotted. Inspect the month-by-month table below.</p></div>}
            <div className="atlas-months" role="group" aria-label="Inspect month">{months.map(month => <button key={month} type="button" aria-pressed={month === activeMonth} onClick={() => setSelectedMonth(month)} data-testid={`button-atlas-month-${month}`}>{month}</button>)}</div>
            <div className="atlas-readout" aria-live="polite"><h4 data-testid="text-atlas-selected-month">{activeMonth} / Estimated monthly visits</h4><dl>{profiles.map(profile => { const value = series.get(profile)?.get(activeMonth); return <div key={profile.domain}><dt>{profile.domain}{hidden.includes(profile.domain) ? ' (hidden in chart)' : ''}</dt><dd data-testid={`text-atlas-visits-${profile.domain}`}>{value === undefined ? 'Not reported' : number(value)}</dd></div>; })}</dl></div>
            <details className="atlas-table"><summary>View all monthly estimates as a table</summary><div style={{overflowX:'auto'}}><table className="comparison-table"><caption>Estimated visits by report month. Missing or duplicate values are not reported or interpolated.</caption><thead><tr><th scope="col">Month</th>{profiles.map(profile => <th key={profile.domain} scope="col">{profile.domain}</th>)}</tr></thead><tbody>{months.map(month => <tr key={month}><th scope="row">{month}</th>{profiles.map(profile => {const value = series.get(profile)?.get(month); return <td key={profile.domain}>{value === undefined ? 'Not reported' : number(value)}</td>;})}</tr>)}</tbody></table></div></details>
          </> : <div className="desk-empty"><ChartNoAxesCombined size={26} aria-hidden="true"/><h3>No monthly values in this report.</h3><p>There is nothing to plot. Check the source brief and its written findings instead.</p></div>}
          <div className="atlas-profile-notes"><span className="dl-eyebrow">Report-level measures / {screen.report.period}</span><div>{profiles.map(profile => <p key={profile.domain}><strong>{profile.domain}</strong><span>Average visits: {valid(profile.averageVisits) ? number(profile.averageVisits) : 'Not reported'} · Traffic change: {profile.trafficChangePercent !== null && Number.isFinite(profile.trafficChangePercent) ? `${profile.trafficChangePercent > 0 ? '+' : ''}${profile.trafficChangePercent}%` : 'Not reported'}</span></p>)}</div></div>
        </div>
      </div>
      <aside className="atlas-aside" aria-label="Evidence and seller actions">
        <span className="dl-eyebrow">Trace the source</span><h3>From signal to conversation.</h3>
        <Link href={`/history/${encodeURIComponent(screen.id)}`} data-testid={`link-atlas-report-${screen.id}`}>Read full saved report <ArrowUpRight size={13} style={{display:'inline'}}/></Link>
        <h4>Report evidence</h4>
        {screen.report.findings.length ? <ol>{screen.report.findings.map(finding => <li key={finding.id}><strong>{finding.title}</strong><small>{finding.metric} · {finding.value} · {finding.period || screen.report.period}</small>{link(finding.sourceUrl) ? <a href={link(finding.sourceUrl)!} target="_blank" rel="noopener noreferrer" data-testid={`link-atlas-source-${screen.id}-${finding.id}`}>{finding.source || 'Open source'} <ArrowUpRight size={12} style={{display:'inline'}}/></a> : <small>{finding.source || 'Source link unavailable'}</small>}</li>)}</ol> : <p className="desk-note">No cited findings were saved with this report.</p>}
        <h4>Ask the seller</h4>
        {[...new Set([...screen.report.sellerQuestions, ...screen.report.findings.map(finding => finding.verificationQuestion).filter(Boolean)])].length ? <ol>{[...new Set([...screen.report.sellerQuestions, ...screen.report.findings.map(finding => finding.verificationQuestion).filter(Boolean)])].map((question, index) => <li key={index}>{question}</li>)}</ol> : <p className="desk-note">No seller questions were saved with this report.</p>}
        <p className="atlas-caution">{screen.report.sourceNotice || 'Traffic estimates are directional and should be verified with the seller.'} Monthly values above belong only to this saved report; different report periods are never combined.</p>
      </aside>
    </div>}
  </section>;
}