import { useState } from 'react';
import { ArrowUpRight, FileText, Info, MessageSquareText } from 'lucide-react';
import type { DomainProfile, Finding, ScreenReport as ScreenReportType, ShareItem, TimePoint } from '@workspace/api-client-react';

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const tabs = [
  { id: 'overview', label: '01  Overview' },
  { id: 'profiles', label: '02  Traffic profiles' },
  { id: 'findings', label: '03  Findings' },
  { id: 'questions', label: '04  Seller questions' },
] as const;
type Tab = typeof tabs[number]['id'];

function formatVisits(value: number) {
  return Number.isFinite(value) ? compactFormat.format(value) : '—';
}

function formatShare(value: number) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}

function formatMonth(value: string) {
  const date = new Date(value.length === 7 ? `${value}-01T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(date);
}

function Change({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <span className="delta">Not available</span>;
  return <span className={`delta ${value >= 0 ? 'up' : 'down'}`}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
}

function MiniChart({ points, compare = false }: { points: TimePoint[]; compare?: boolean }) {
  if (!points.length) return <div className="mini-chart" style={{ display: 'grid', placeItems: 'center', color: '#88958f', fontSize: 11 }}>No monthly series available</div>;
  const values = points.map(point => point.visits);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? 50 : 4 + (index / (points.length - 1)) * 92;
    const y = 82 - ((point.visits - min) / spread) * 66;
    return `${x},${y}`;
  }).join(' ');
  return (
    <>
      <svg className="mini-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Monthly visits trend from ${formatMonth(points[0].month)} to ${formatMonth(points[points.length - 1].month)}`}>
        {[16, 49, 82].map(y => <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#e3e7df" strokeWidth=".7" strokeDasharray="2 2" />)}
        <polyline points={coordinates} fill="none" stroke={compare ? '#6d9c9c' : '#df704b'} strokeWidth="2.1" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point, index) => {
          const x = points.length === 1 ? 50 : 4 + (index / (points.length - 1)) * 92;
          const y = 82 - ((point.visits - min) / spread) * 66;
          return <circle key={`${point.month}-${index}`} cx={x} cy={y} r="1.6" fill={compare ? '#6d9c9c' : '#df704b'} stroke="#fbfaf5" strokeWidth=".8"><title>{formatMonth(point.month)}: {numberFormat.format(point.visits)} visits</title></circle>;
        })}
      </svg>
      <div className="chart-axis"><span>{formatMonth(points[0].month)}</span><span>Monthly visits · estimated</span><span>{formatMonth(points[points.length - 1].month)}</span></div>
    </>
  );
}

function Breakdown({ title, items, compare = false }: { title: string; items: ShareItem[]; compare?: boolean }) {
  return (
    <div className={`breakdown ${compare ? 'compare' : ''}`}>
      <h5>{title}</h5>
      {items.length ? items.map((item, index) => (
        <div className="bar-row" key={`${item.label}-${index}`} data-testid={`row-${title.toLowerCase().replaceAll(' ', '-')}-${index}`}>
          <span title={item.label}>{item.label}</span>
          <div className="bar-track" role="meter" aria-label={`${item.label} share`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, item.share * 100))}><div className="bar-fill" style={{ width: `${Math.min(100, Math.max(0, item.share * 100))}%` }} /></div>
          <span className="bar-value">{formatShare(item.share)}</span>
        </div>
      )) : <p style={{ fontSize: 11, color: '#88958f' }}>No breakdown available.</p>}
    </div>
  );
}

function Profile({ profile, label, compare = false }: { profile: DomainProfile; label: string; compare?: boolean }) {
  return (
    <article className="panel profile-panel" data-testid={`profile-${compare ? 'comparison' : 'target'}`}>
      <div className="profile-top">
        <div><span className="eyebrow" style={{ color: '#89948e' }}>{label}</span><h4>{profile.domain}</h4></div>
        <span className={`profile-tag ${compare ? 'compare' : ''}`}>{compare ? 'Benchmark' : 'Subject'}</span>
      </div>
      <div className="profile-stat">
        <strong data-testid={`value-average-visits-${compare ? 'comparison' : 'target'}`}>{formatVisits(profile.averageVisits)}</strong>
        <small>avg. monthly<br />visits</small>
        <Change value={profile.trafficChangePercent} />
      </div>
      <MiniChart points={profile.monthlyVisits} compare={compare} />
      <Breakdown title="Traffic channels" items={profile.channels} compare={compare} />
      <Breakdown title="Top geographies" items={profile.geography} compare={compare} />
    </article>
  );
}

function FindingCard({ finding, index }: { finding: Finding; index: number }) {
  const validUrl = /^https?:\/\//i.test(finding.sourceUrl);
  return (
    <article className="finding-card" data-testid={`finding-${finding.id}`}>
      <div className="finding-side">
        <span className={`severity ${finding.severity === 'context' ? 'context' : ''}`}>{finding.severity === 'watch' ? 'To verify' : 'Context'}</span>
        <strong>{String(index + 1).padStart(2, '0')} / {finding.value}</strong>
      </div>
      <div className="finding-body">
        <h4>{finding.title}</h4>
        <div className="finding-meta"><span>{finding.metric}</span><span>{finding.period}</span><span>{finding.source}</span></div>
        <p>{finding.whyItMatters}</p>
        <div className="finding-question"><strong>Ask the seller</strong><br />{finding.verificationQuestion}</div>
        {validUrl && <a className="source-link" href={finding.sourceUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-source-${finding.id}`}>View source <ArrowUpRight size={13} /></a>}
      </div>
    </article>
  );
}

export function ScreenReport({ report }: { report: ScreenReportType }) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const date = new Date(report.generatedAt);
  const generatedLabel = Number.isNaN(date.getTime()) ? report.generatedAt : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  return (
    <div data-testid="report-screen">
      <div className="report-head">
        <div><span className="eyebrow" style={{ color: '#d66240' }}>Analysis complete · {report.period}</span><h2>Screening brief</h2></div>
        <span className="report-date" data-testid="text-generated-at">Generated {generatedLabel}</span>
      </div>
      <div className="report-tabs" role="tablist" aria-label="Report sections">
        {tabs.map(tab => <button key={tab.id} type="button" className={`tab ${activeTab === tab.id ? 'active' : ''}`} role="tab" aria-selected={activeTab === tab.id} aria-controls={`panel-${tab.id}`} onClick={() => setActiveTab(tab.id)} data-testid={`tab-${tab.id}`}>{tab.label}</button>)}
      </div>

      <section id="panel-overview" role="tabpanel" aria-label="Overview" className="report-section" style={{ display: activeTab === 'overview' ? 'block' : 'none' }}>
        <div className="overview-grid">
          <div className="panel panel-pad">
            <div className="panel-heading"><h3>At a glance</h3><small>Comparable traffic estimates</small></div>
            <table className="comparison-table"><thead><tr><th>Metric</th><th>Target · {report.target.domain}</th><th>Comparison · {report.comparison.domain}</th></tr></thead>
              <tbody>
                <tr><td>Avg. monthly visits</td><td data-testid="value-target-average">{numberFormat.format(report.target.averageVisits)}</td><td data-testid="value-comparison-average">{numberFormat.format(report.comparison.averageVisits)}</td></tr>
                <tr><td>Traffic change</td><td><Change value={report.target.trafficChangePercent} /></td><td><Change value={report.comparison.trafficChangePercent} /></td></tr>
                <tr><td>Leading channel</td><td>{report.target.topChannel ? `${report.target.topChannel.label ?? '—'} · ${report.target.topChannel.share == null ? '—' : formatShare(report.target.topChannel.share)}` : 'Not available'}</td><td>{report.comparison.topChannel ? `${report.comparison.topChannel.label ?? '—'} · ${report.comparison.topChannel.share == null ? '—' : formatShare(report.comparison.topChannel.share)}` : 'Not available'}</td></tr>
                <tr><td>Leading country</td><td>{report.target.topCountry ? `${report.target.topCountry.label ?? '—'} · ${report.target.topCountry.share == null ? '—' : formatShare(report.target.topCountry.share)}` : 'Not available'}</td><td>{report.comparison.topCountry ? `${report.comparison.topCountry.label ?? '—'} · ${report.comparison.topCountry.share == null ? '—' : formatShare(report.comparison.topCountry.share)}` : 'Not available'}</td></tr>
              </tbody>
            </table>
          </div>
          <aside className="panel panel-pad brief-panel"><span className="eyebrow">Research readout</span><h3>What the evidence suggests.</h3><p data-testid="text-summary">{report.summary || 'No narrative was returned for this screen.'}</p></aside>
        </div>
        <p className="source-notice"><Info size={15} />{report.sourceNotice}</p>
      </section>

      <section id="panel-profiles" role="tabpanel" aria-label="Traffic profiles" className="report-section" style={{ display: activeTab === 'profiles' ? 'block' : 'none' }}>
        <div className="section-title"><h3>Traffic profiles</h3><small>Reported period · {report.period}</small></div>
        <div className="profile-grid"><Profile profile={report.target} label="01 / TARGET DOMAIN" /><Profile profile={report.comparison} label="02 / COMPARISON DOMAIN" compare />{report.additionalProfiles?.map((profile, index) => <Profile key={`${profile.domain}-${index}`} profile={profile} label={`${String(index + 3).padStart(2, '0')} / ADDITIONAL COMPARISON`} compare />)}</div>
        <p className="source-notice"><Info size={15} />{report.sourceNotice}</p>
      </section>

      <section id="panel-findings" role="tabpanel" aria-label="Findings" className="report-section" style={{ display: activeTab === 'findings' ? 'block' : 'none' }}>
        <div className="section-title"><h3>Evidence-backed findings</h3><small>{report.findings.length} observations</small></div>
        {report.findings.length ? <div className="finding-list">{report.findings.map((finding, index) => <FindingCard key={finding.id} finding={finding} index={index} />)}</div> : <div className="panel panel-pad" style={{ color: '#73817c', fontSize: 13 }}>No specific findings were returned for this comparison. Review the profiles and request source data from the seller.</div>}
      </section>

      <section id="panel-questions" role="tabpanel" aria-label="Seller questions" className="report-section" style={{ display: activeTab === 'questions' ? 'block' : 'none' }}>
        <div className="section-title"><h3>Questions for the seller</h3><small>Bring these to the conversation</small></div>
        <div className="panel panel-pad">
          <div className="panel-heading"><h3 style={{ display: 'flex', gap: 9, alignItems: 'center' }}><MessageSquareText size={17} color="#d96542" /> Follow-up checklist</h3><small>{report.sellerQuestions.length} questions</small></div>
          {report.sellerQuestions.length ? <div className="questions-list">{report.sellerQuestions.map((question, index) => <div key={index} className="question-row" data-testid={`text-seller-question-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><div>{question}</div></div>)}</div> : <p style={{ color: '#7b8985', fontSize: 13 }}>No follow-up questions were returned. Ask for first-party analytics access and channel-level documentation.</p>}
        </div>
        <div className="limitations"><h4 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><FileText size={15} /> Scope & limitations</h4>{report.limitations.length ? <ul>{report.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul> : <p style={{ margin: 0, color: '#73807a', fontSize: 11 }}>Traffic estimates are directional and should be verified with first-party data.</p>}</div>
      </section>
    </div>
  );
}