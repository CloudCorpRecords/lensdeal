import { useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, LibraryBig, Plus, X } from 'lucide-react';
import { getDiscoverStartupsQueryKey, useDiscoverStartups } from '@workspace/api-client-react';
import type { DiscoverStartupsParams, DiscoveryCompany } from '@workspace/api-client-react';

type ChoiceResult = { ok: boolean; message: string };
type Props = {
  targetDomain: string;
  peerAvailable: boolean;
  locked: boolean;
  onChooseTarget: (domain: string) => ChoiceResult;
  onChoosePeer: (domain: string) => ChoiceResult;
};

const categories = [
  ['ai', 'AI'], ['saas', 'SaaS'], ['developer-tools', 'Developer tools'],
  ['fintech', 'Fintech'], ['marketing', 'Marketing'], ['ecommerce', 'Ecommerce'],
  ['productivity', 'Productivity'], ['analytics', 'Analytics'],
  ['education', 'Education'], ['marketplace', 'Marketplace'], ['mobile-apps', 'Mobile apps'],
] as const;
const sorts = [
  ['listed-desc', 'Recently listed'], ['revenue-desc', 'Revenue, high to low'], ['best-deal', 'Best deal'],
] as const;
const validDomain = (value: string | null) => {
  if (!value) return null;
  const domain = value.trim().toLowerCase();
  return domain.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) ? domain : null;
};
const listingHref = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'trustmrr.com' || url.hostname.endsWith('.trustmrr.com')) ? url.href : null;
  } catch { return null; }
};
const errorStatus = (error: unknown) => error && typeof error === 'object' && 'status' in error ? error.status : null;
const discoveryError = (error: unknown) => {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') return data.error;
  }
  return null;
};

export function CompanyDiscovery({ targetDomain, peerAvailable, locked, onChooseTarget, onChoosePeer }: Props) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<DiscoverStartupsParams['category']>();
  const [onSale, setOnSale] = useState<DiscoverStartupsParams['onSale']>();
  const [sort, setSort] = useState<NonNullable<DiscoverStartupsParams['sort']>>('listed-desc');
  const [page, setPage] = useState(1);
  const [pendingTarget, setPendingTarget] = useState<{ name: string; domain: string } | null>(null);
  const [notice, setNotice] = useState('');
  const params: DiscoverStartupsParams = { page, category, onSale, sort };
  const results = useDiscoverStartups(params, {
    query: { enabled: open, queryKey: getDiscoverStartupsQueryKey(params), retry: false },
    request: { credentials: 'include' },
  });

  function changeFilter(update: () => void) {
    update();
    setPage(1);
    setPendingTarget(null);
    setNotice('');
  }
  function chooseTarget(company: DiscoveryCompany, domain: string) {
    setNotice('');
    if (targetDomain.trim() && validDomain(targetDomain.trim()) !== domain) {
      setPendingTarget({ name: company.name, domain });
      return;
    }
    const result = onChooseTarget(domain);
    setPendingTarget(null);
    setNotice(result.message);
  }
  function choosePeer(domain: string) {
    const result = onChoosePeer(domain);
    setPendingTarget(null);
    setNotice(result.message);
  }

  return <section className="discovery" aria-labelledby="discovery-title" data-testid="section-company-discovery">
    <div className="discovery-intro">
      <div>
        <span className="dl-eyebrow">02 / Outside the desk</span>
        <h2 id="discovery-title">Find a company to investigate.</h2>
        <p>Browse TrustMRR listings for a starting point, then choose which domain belongs in your editable screen. Nothing runs until you say so.</p>
      </div>
      <button type="button" className="discovery-trigger" aria-expanded={open} aria-controls="discovery-body" onClick={() => { setOpen(current => !current); setPendingTarget(null); setNotice(''); }} data-testid="button-toggle-discovery">
        <LibraryBig size={16} aria-hidden="true" /> {open ? 'Close directory' : 'Browse companies'} {open ? <X size={15} aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}
      </button>
    </div>
    {open && <div className="discovery-body" id="discovery-body" data-testid="panel-company-discovery">
      <div className="discovery-context">
        <p>These are provider listings, not DealLens recommendations. Availability and descriptions come from TrustMRR; traffic evidence is only gathered if you separately run a screen.</p>
        <a href="https://trustmrr.com/" target="_blank" rel="noopener noreferrer" data-testid="link-trustmrr-source">Visit TrustMRR <ExternalLink size={12} aria-hidden="true" style={{ display: 'inline' }}/></a>
      </div>
      <div className="discovery-filters" role="group" aria-label="Filter company listings">
        <label>Category
          <select value={category ?? ''} onChange={event => changeFilter(() => setCategory((event.target.value || undefined) as DiscoverStartupsParams['category']))} data-testid="select-discovery-category">
            <option value="">All categories</option>
            {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Availability
          <select value={onSale ?? ''} onChange={event => changeFilter(() => setOnSale((event.target.value || undefined) as DiscoverStartupsParams['onSale']))} data-testid="select-discovery-sale">
            <option value="">All listings</option><option value="true">For sale</option><option value="false">Not for sale</option>
          </select>
        </label>
        <label>Order
          <select value={sort} onChange={event => changeFilter(() => setSort(event.target.value as NonNullable<DiscoverStartupsParams['sort']>))} data-testid="select-discovery-sort">
            {sorts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <div className="discovery-result-head"><span>Company index / TrustMRR</span><span data-testid="text-discovery-page">Page {page} of at most 20</span></div>
      {results.isPending || (results.isFetching && !results.data) ? <div aria-label="Loading company listings" data-testid="status-discovery-loading"><div className="desk-skeleton"/><div className="desk-skeleton"/><div className="desk-skeleton"/></div>
        : results.isError ? <div className="discovery-state error" role="alert" data-testid="status-discovery-error">
          <h3>{errorStatus(results.error) === 429 ? 'The directory is taking a pause.' : 'The directory is unavailable.'}</h3>
          <p>{discoveryError(results.error) ?? (errorStatus(results.error) === 429 ? 'TrustMRR is rate-limiting requests. Wait a moment before trying again, or enter a domain manually.' : 'Listings could not be loaded right now. Your form is untouched; you can still enter domains manually.')}</p>
          <button type="button" onClick={() => void results.refetch()} data-testid="button-retry-discovery">Try again</button>
        </div>
        : !results.data?.data.length ? <div className="discovery-state" data-testid="status-discovery-empty">
          <h3>No listings on this page.</h3><p>Try another category or availability, or return to a previous page. Manual domain entry remains available above.</p>
        </div>
        : <div className="discovery-list" data-testid="list-discovery-companies">
          {results.data.data.map((company, index) => {
            const domain = validDomain(company.domain);
            const href = listingHref(company.listingUrl);
            const id = `${company.slug || 'listing'}-${index}`;
            return <article className="discovery-item" key={id} data-testid={`card-discovery-company-${id}`}>
              <div className="discovery-item-main">
                <div className="discovery-item-top"><h3>{company.name}</h3>{company.category && <span className="discovery-category">{company.category}</span>}{company.onSale && <span className="discovery-sale">For sale</span>}</div>
                {company.description && <p>{company.description}</p>}
                <span className={`discovery-domain${domain ? '' : ' unavailable'}`} data-testid={`text-discovery-domain-${id}`}>{domain ?? 'Website missing or invalid; no usable domain supplied. Enter one manually.'}</span>
                {pendingTarget?.domain === domain && <div className="discovery-confirm" role="group" aria-label={`Replace target with ${company.name}?`} data-testid={`status-confirm-target-${id}`}>
                  <span>Replace your current target with <strong>{domain}</strong>? Your existing entry will be removed.</span>
                  <button type="button" onClick={() => { const result = onChooseTarget(domain!); setNotice(result.message); setPendingTarget(null); }} data-testid={`button-confirm-target-${id}`}>Replace target</button>
                  <button type="button" onClick={() => setPendingTarget(null)} data-testid={`button-cancel-target-${id}`}>Keep current</button>
                </div>}
              </div>
              <div className="discovery-item-actions">
                {href && <a href={href} target="_blank" rel="noopener noreferrer" data-testid={`link-discovery-listing-${id}`}>Provider listing <ExternalLink size={12} aria-hidden="true"/></a>}
                <button type="button" disabled={!domain || locked} onClick={() => domain && chooseTarget(company, domain)} data-testid={`button-discovery-target-${id}`}>Use as target</button>
                <button type="button" disabled={!domain || !peerAvailable || locked} onClick={() => domain && choosePeer(domain)} data-testid={`button-discovery-peer-${id}`} title={!peerAvailable ? 'All peer slots are filled; edit the comparison form to make room.' : undefined}><Plus size={12} aria-hidden="true"/> Add as peer</button>
              </div>
            </article>;
          })}
        </div>}
      {notice && <p className="desk-note" role="status" data-testid="status-discovery-selection">{notice}</p>}
      {!peerAvailable && <p className="desk-note" data-testid="status-discovery-peer-limit">All peer slots are filled. Edit the comparison form above to make room before adding another.</p>}
      {!results.isError && !results.isPending && <div className="discovery-pagination" aria-label="Directory pages">
        <button type="button" disabled={page <= 1 || results.isFetching} onClick={() => { setPage(current => Math.max(1, current - 1)); setPendingTarget(null); setNotice(''); }} data-testid="button-discovery-previous"><ArrowLeft size={13} aria-hidden="true"/> Previous</button>
        <span data-testid="status-discovery-pagination">{page} / 20</span>
        <button type="button" disabled={!results.data?.hasMore || page >= 20 || results.isFetching} onClick={() => { setPage(current => Math.min(20, current + 1)); setPendingTarget(null); setNotice(''); }} data-testid="button-discovery-next">Next <ArrowRight size={13} aria-hidden="true"/></button>
      </div>}
      <div className="discovery-foot"><span>Source: TrustMRR company listings. DealLens does not verify listing claims.</span><span>Only a supplied, valid domain can be copied into your screen.</span></div>
    </div>}
  </section>;
}