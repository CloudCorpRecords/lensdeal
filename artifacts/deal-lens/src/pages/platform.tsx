import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen, CreditCard, FolderOpen, LogOut, Plus, Printer, ScanSearch, Trash2, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Form } from '@/components/ui/form';
import { ScreenReport } from '@/components/screen-report';
import { ExplanationAnswer } from '@/components/explanation-answer';
import {
  useGetAccount, useListScreens, useCreateScreen, useGetScreen, useDeleteScreen,
  useListCompilations, useCreateCompilation, useGetCompilation, useDeleteCompilation,
  useCreateExplanation, useListExplanations, useListPlans, useCreateCheckout, useCreatePortal,
  getGetAccountQueryKey, getListScreensQueryKey, getListCompilationsQueryKey, getListExplanationsQueryKey,
  getGetScreenQueryKey, getGetCompilationQueryKey, getGetAccountQueryOptions,
} from '@workspace/api-client-react';
import type { ScreenInput, SavedScreen } from '@workspace/api-client-react';

const dateLabel = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { dateStyle:'medium' }).format(date); };
const timestampLabel = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', {dateStyle:'medium',timeStyle:'short'}).format(date); };
const normalize = (value: string) => { try { return new URL(value.trim().includes('://') ? value.trim() : `https://${value.trim()}`).hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,''); } catch { return value.trim().toLowerCase(); } };
const validDomain = (domain: string) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) && domain.length <= 253;
const parseDomain = (value: string) => {
  const raw = value.trim();
  if (!/^(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\/?$/i.test(raw)) return null;
  const domain = normalize(raw);
  return validDomain(domain) ? domain : null;
};
const screenScope = (screen: SavedScreen) => screen.comparisonDomains?.length
  ? `Compared with ${screen.comparisonDomains.join(', ')}`
  : 'Target-only screen';
const message = (error: unknown) => {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error.trim()) return data.error;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
};
const priceLabel = (tier: string, price: number, display?: string | null) => tier === 'free' ? 'Free' : price === 0 ? 'Price pending' : display?.trim() || 'Price shown at checkout';
const safeUrl = (value: string) => { try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : null; } catch { return null; } };
// The generated client calls root-relative /api paths. Under any Vite BASE_PATH,
// those stay on this origin (the shared API mount) and carry the Clerk session cookie.
const cookieRequest = {request:{credentials:'include' as const}};
type BatchWork = {inputs:ScreenInput[];nextIndex:number;links:{id:string;label:string}[];retryIndex?:number};

export function Desk({ children, section }: { children: React.ReactNode; section: string }) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const account = useGetAccount(cookieRequest);
  const nav = [{href:'/workspace',label:'Workspace',icon:ScanSearch},{href:'/history',label:'Saved reports',icon:BookOpen},{href:'/compilations',label:'Compilations',icon:FolderOpen},{href:'/plans',label:'Plans & usage',icon:CreditCard}];
  return <div className="desk"><aside className="desk-side"><Link href="/workspace" className="dl-logo" data-testid="link-brand"><span className="dl-logo-mark"><ScanSearch size={17}/></span>deal<span style={{fontFamily:'var(--app-font-serif)',fontWeight:400}}>lens</span>.</Link><span className="desk-nav-label">Research desk</span><nav>{nav.map(item => <Link href={item.href} key={item.href} className={location.startsWith(item.href) ? 'active' : ''} data-testid={`link-${item.label.toLowerCase().replaceAll(' ','-')}`}><item.icon size={17}/>{item.label}</Link>)}</nav><div className="desk-side-bottom"><p className="desk-nav-label" style={{margin:'0 0 12px'}}>Account</p><div style={{fontSize:13}}>{user?.primaryEmailAddress?.emailAddress || 'Your desk'}</div><p style={{color:'#a3b8a7',fontSize:12}}>{account.data?.tier ? `${account.data.tier.toUpperCase()} plan` : 'Research with perspective'}</p><button onClick={() => signOut({redirectUrl:import.meta.env.BASE_URL})} data-testid="button-sign-out"><LogOut size={15} style={{display:'inline',verticalAlign:'middle',marginRight:8}}/> Sign out</button></div></aside><div className="desk-main"><header className="desk-top"><span>DealLens / {section}</span><span>First-pass intelligence · not a verdict</span></header><main className="desk-body">{children}</main></div></div>;
}

function Heading({ eyebrow,title,description,action }: { eyebrow:string; title:string; description:string; action?:React.ReactNode }) {
  return <div className="desk-heading"><div><span className="dl-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}
function QueryState({error,retry}: {error:unknown;retry:()=>void}) { return <div className="desk-alert" role="alert">{message(error)} <button type="button" onClick={retry} data-testid="button-retry-query">Try again</button></div>; }
function Loading() { return <div aria-label="Loading"><div className="desk-skeleton"/><div className="desk-skeleton"/><div className="desk-skeleton"/></div>; }
function Empty({ title,body,link,linkText }: {title:string;body:string;link?:string;linkText?:string}) { return <div className="desk-empty"><span className="dl-eyebrow">Nothing here yet</span><h3>{title}</h3><p>{body}</p>{link && <Link className="desk-button" href={link} data-testid="link-empty-action">{linkText} <ArrowRight size={15}/></Link>}</div>; }
function ScreenSignals({screen}: {screen:SavedScreen}) {
  const {report} = screen;
  const comparison = report.comparison;
  return <div className="screen-signals" data-testid={`signals-screen-${screen.id}`}>
    <span>{report.period} · Estimated visits: {new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(report.target.averageVisits)} target{comparison ? ` / ${new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(comparison.averageVisits)} peer` : ''}</span>
    {report.findings.length > 0 && <span>{report.findings.length} findings · {report.findings.slice(0,2).map(finding => finding.title).join(' · ')}</span>}
    {report.summary && <span className="screen-signal-summary">{report.summary}</span>}
  </div>;
}
function SavedRows({screens}: {screens:SavedScreen[]}) { return <div className="desk-list">{screens.map(screen => <div className="desk-row" key={screen.id}><div><strong>{screen.targetDomain}</strong><small>{screenScope(screen)} · {dateLabel(screen.createdAt)}</small><ScreenSignals screen={screen}/></div><div className="desk-row-actions"><Link href={`/history/${encodeURIComponent(screen.id)}`} data-testid={`link-open-screen-${screen.id}`}>Open brief <ArrowRight size={13} style={{display:'inline'}}/></Link></div></div>)}</div>; }

export function Workspace() {
  const account = useGetAccount(cookieRequest);
  const screens = useListScreens(cookieRequest);
  const create = useCreateScreen(cookieRequest);
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const form = useForm<{targetDomain:string;comparisonDomain:string}>({defaultValues:{targetDomain:'',comparisonDomain:''}});
  const [mode,setMode] = useState<'solo'|'compare'>('solo');
  const [extras,setExtras] = useState<string[]>([]);
  const [error,setError] = useState('');
  const [batch,setBatch] = useState<BatchWork | null>(null);
  const [running,setRunning] = useState(false);
  const [report,setReport] = useState<Awaited<ReturnType<typeof create.mutateAsync>> | null>(null);
  const enterprise = account.data?.tier === 'enterprise';
  const remaining = account.data ? Math.max(0,account.data.screenLimit-account.data.screensUsed) : null;
  const peerCount = mode === 'compare' ? 1 + (enterprise ? extras.length : 0) : 0;
  const domainCount = 1 + peerCount;
  const requiredUnits = Math.max(1,peerCount);
  const pendingBatch = batch !== null && batch.nextIndex < batch.inputs.length;
  async function runBatch(work:BatchWork) {
    if (running) return;
    setError(''); setRunning(true);
    let links = [...work.links];
    for (let index=work.nextIndex; index<work.inputs.length; index++) {
      setBatch({...work,nextIndex:index,links});
      try {
        // Refetch here, rather than reusing the account captured before earlier batch parts.
        const freshAccount = await queryClient.fetchQuery({...getGetAccountQueryOptions(cookieRequest), staleTime:0});
        const available = Math.max(0,freshAccount.screenLimit-freshAccount.screensUsed);
        const units = Math.max(1,work.inputs[index].comparisonDomains?.length ?? 0);
        // An uncertain network failure may have completed server-side; replay that
        // same request ID even when its charged units now exhaust the allowance.
        if (available < units && work.retryIndex !== index) {
          setError(`Brief ${index+1} needs ${units} screen ${units === 1 ? 'unit' : 'units'}, with ${available} available. Allowance resets ${dateLabel(freshAccount.resetsAt)}. Completed reports remain saved.`);
          setRunning(false);
          return;
        }
        const result = await create.mutateAsync({data:work.inputs[index]});
        setReport(result);
        if (result.id && !links.some(link => link.id === result.id)) links = [...links,{id:result.id,label:work.inputs[index].comparisonDomains?.length ? `Brief ${index+1}: ${work.inputs[index].comparisonDomains?.join(', ')}` : `Brief ${index+1}: target only`}];
        setBatch({...work,nextIndex:index+1,links,retryIndex:undefined});
        void queryClient.invalidateQueries({queryKey:getListScreensQueryKey()});
        void queryClient.invalidateQueries({queryKey:getGetAccountQueryKey()});
      } catch (cause) {
        setError(`Part ${index+1} of ${work.inputs.length} could not be completed: ${message(cause)}. Completed reports remain saved; retry resumes at this part with the same request ID.`);
        setBatch({...work,nextIndex:index,links,retryIndex:index});
        setRunning(false);
        return;
      }
    }
    setRunning(false);
    if (work.inputs.length === 1 && links[0]) navigate(`/history/${encodeURIComponent(links[0].id)}`);
  }
  function submit(values:{targetDomain:string;comparisonDomain:string}) {
    if (running || pendingBatch) { setError('Finish or resume the current research set before starting a new one.'); return; }
    const raw = [values.targetDomain,...(mode === 'compare' ? [values.comparisonDomain,...(enterprise ? extras : [])] : [])];
    const domains = raw.map(parseDomain);
    if (domains.some(domain => !domain)) { setError('Complete every visible field with a valid domain such as example.com (no paths or ports).'); return; }
    if (new Set(domains).size !== domains.length) { setError('Each domain must be different.'); return; }
    if (domains.length > (enterprise ? 20 : 2)) { setError(enterprise ? 'A research set can contain no more than 20 domains.' : 'Your plan supports one target and one peer per screen.'); return; }
    if (remaining !== null && remaining < requiredUnits) { setError(`This screen needs ${requiredUnits} screen ${requiredUnits === 1 ? 'unit' : 'units'}, but you have ${remaining} remaining. Your allowance resets ${account.data ? dateLabel(account.data.resetsAt) : 'at your next reset'}.`); return; }
    const target = domains[0]!;
    const comparisons = domains.slice(1) as string[];
    const inputs:ScreenInput[] = [];
    if (!comparisons.length) inputs.push({targetDomain:target,comparisonDomains:[],requestId:crypto.randomUUID()});
    else for (let index=0;index<comparisons.length;index+=8) inputs.push({targetDomain:target,comparisonDomains:comparisons.slice(index,index+8),requestId:crypto.randomUUID()});
    const next = {inputs,nextIndex:0,links:[]};
    setReport(null); setBatch(next); void runBatch(next);
  }
  return <Desk section="Workspace">
    <Heading eyebrow="01 / New research" title="The screening desk." description="Study one business on its own, or put its traffic beside relevant peers. Directional evidence for seller conversations, never an investment recommendation."/>
    <div className="desk-grid">
      <section className="desk-panel">
        <span className="dl-eyebrow">New traffic screen</span><h2 style={{marginTop:14}}>What are you looking at?</h2>
         <Form {...form}><form onSubmit={form.handleSubmit(submit)} noValidate>
           <div className="desk-mode-switch" role="radiogroup" aria-label="Research mode">
             <label className={`desk-mode ${mode === 'solo' ? 'selected' : ''}`}><input type="radio" name="screen-mode" value="solo" checked={mode === 'solo'} onChange={() => setMode('solo')} disabled={running} data-testid="radio-mode-solo"/><span><strong>Target only</strong><small>One business, in focus</small></span><span className="desk-mode-unit">01 unit</span></label>
             <label className={`desk-mode ${mode === 'compare' ? 'selected' : ''}`}><input type="radio" name="screen-mode" value="compare" checked={mode === 'compare'} onChange={() => setMode('compare')} disabled={running} data-testid="radio-mode-compare"/><span><strong>Compare peers</strong><small>Put estimates in context</small></span><span className="desk-mode-unit">From 01 unit</span></label>
           </div>
           <div className="desk-fields">
             <label className="desk-field">Target domain<input {...form.register('targetDomain')} placeholder="targetbusiness.com" autoComplete="off" spellCheck={false} aria-label="Target domain" data-testid="input-target-domain"/></label>
             {mode === 'compare' && <label className="desk-field">Peer domain 01<input {...form.register('comparisonDomain')} placeholder="relevantpeer.com" autoComplete="off" spellCheck={false} aria-label="Comparison domain" data-testid="input-comparison-domain"/></label>}
           </div>
           {mode === 'compare' && enterprise && <div><p className="desk-note">Add up to 19 peers in total. Each peer beyond the first adds one screen unit. Sets larger than eight peers are saved as separate briefs, ready to compile.</p>
             <div className="desk-extra-fields">{extras.map((value,index) => <div className="desk-field" key={index}><label htmlFor={`extra-${index}`}>Peer domain {String(index+2).padStart(2,'0')}</label><div className="desk-removable"><input id={`extra-${index}`} value={value} onChange={event => setExtras(current => current.map((item,i) => i === index ? event.target.value : item))} placeholder="anotherpeer.com" autoComplete="off" spellCheck={false} data-testid={`input-extra-${index}`}/><button type="button" className="desk-button secondary" aria-label={`Remove peer ${index+2}`} onClick={() => setExtras(current => current.filter((_,i) => i !== index))} disabled={running} data-testid={`button-remove-extra-${index}`}><X size={16}/></button></div></div>)}</div>
             <button type="button" className="desk-button secondary" onClick={() => setExtras(current => current.length < 18 ? [...current,''] : current)} disabled={running || extras.length >= 18} data-testid="button-add-domain"><Plus size={15}/> Add peer</button>
             {extras.length >= 18 && <p className="desk-note">Maximum reached: 20 domains including the target.</p>}
           </div>}
           {mode === 'compare' && !enterprise && <p className="desk-note">Your plan includes one peer per screen. Enterprise supports up to 19 peers alongside a target.</p>}
           <div className="desk-estimate" aria-live="polite" data-testid="status-screen-estimate"><strong>{String(domainCount).padStart(2,'0')} / {enterprise ? '20' : '02'} domains</strong><span>{requiredUnits} screen {requiredUnits === 1 ? 'unit' : 'units'} estimated · {remaining === null ? 'Checking allowance' : `${remaining} remaining`}</span></div>
          <div style={{display:'flex',alignItems:'center',gap:16,marginTop:25,flexWrap:'wrap'}}>
             <button className="desk-button" disabled={running || pendingBatch || account.isLoading || account.isError || (remaining !== null && remaining < requiredUnits)} type="submit" data-testid="button-run-screen">{running ? 'Building your briefs…' : pendingBatch ? 'Resume the current set below' : 'Run traffic screen'} <ArrowRight size={16}/></button>
             <span className="desk-note">Target-only and target + one peer each use one unit. Further Enterprise peers use one unit each.</span>
          </div>
        </form></Form>
        {remaining !== null && remaining < requiredUnits && <div className="desk-alert" role="status" data-testid="status-insufficient-units">Not enough screen units for these domains: {requiredUnits} needed, {remaining} remaining. Resets {account.data ? dateLabel(account.data.resetsAt) : 'on your next reset'}. <Link href="/plans">View plans</Link></div>}
        {error && <div className="desk-alert" role="alert">{error}</div>}
        {batch && <div className="desk-panel" style={{marginTop:25,marginBottom:0}} aria-live="polite" data-testid="status-screen-batch">
          <strong>{running ? `Processing brief ${batch.nextIndex+1} of ${batch.inputs.length}` : batch.nextIndex === batch.inputs.length ? 'Research set complete' : `Paused at brief ${batch.nextIndex+1} of ${batch.inputs.length}`}</strong>
           <p className="desk-note">{batch.nextIndex} of {batch.inputs.length} briefs completed. Each completed brief is saved separately. Retrying keeps the same request ID for the unfinished brief.</p>
          {running && <Loading/>}
          {batch.links.length > 0 && <div className="desk-list">{batch.links.map(link => <div className="desk-row" key={link.id}><span>{link.label}</span><Link href={`/history/${encodeURIComponent(link.id)}`} className="desk-button secondary" data-testid={`link-batch-report-${link.id}`}>Open report <ArrowRight size={14}/></Link></div>)}</div>}
           {!running && batch.nextIndex < batch.inputs.length && error && <button type="button" className="desk-button" onClick={() => void runBatch(batch)} data-testid="button-retry-screen">Resume remaining briefs</button>}
          {batch.links.length > 0 && <Link href="/history" className="desk-button secondary" data-testid="link-batch-history">Browse all saved reports <ArrowRight size={14}/></Link>}
          {batch.nextIndex === batch.inputs.length && batch.links.length > 1 && <Link href={`/compilations?screenIds=${encodeURIComponent(batch.links.map(link=>link.id).join(','))}`} className="desk-button secondary" data-testid="link-compile-batch">Create a compilation from these reports <ArrowRight size={14}/></Link>}
        </div>}
      </section>
      <aside className="desk-panel"><span className="dl-eyebrow">Your capacity</span>{account.isLoading ? <Loading/> : account.isError ? <QueryState error={account.error} retry={() => void account.refetch()}/> : account.data && <><h2 style={{marginTop:20}}>{account.data.tier.toUpperCase()} plan</h2><p>Screens used <strong>{account.data.screensUsed} / {account.data.screenLimit}</strong></p><div className="desk-meter"><span style={{width:`${Math.min(100,account.data.screenLimit ? account.data.screensUsed/account.data.screenLimit*100 : 0)}%`}}/></div><p>AI questions used <strong>{account.data.aiUsed} / {account.data.aiLimit}</strong></p><div className="desk-meter"><span style={{width:`${Math.min(100,account.data.aiLimit ? account.data.aiUsed/account.data.aiLimit*100 : 0)}%`}}/></div><p className="desk-note">Allowance resets {dateLabel(account.data.resetsAt)}.</p>{remaining === 0 && <p className="desk-alert">You've used your current screen allowance. Check plans or return after your reset.</p>}<Link href="/plans" className="desk-button secondary" data-testid="link-view-plan">View plan <ArrowRight size={14}/></Link></>}</aside>
    </div>
    {report && <div style={{marginTop:45}}><ScreenReport report={report}/></div>}
    <section style={{marginTop:70}}><div className="desk-heading"><div><span className="dl-eyebrow">Continued work</span><h1 style={{fontSize:44}}>Recent briefs</h1></div><Link href="/history" className="desk-button secondary" data-testid="link-all-history">View all reports <ArrowRight size={15}/></Link></div>{screens.isLoading ? <Loading/> : screens.isError ? <QueryState error={screens.error} retry={() => void screens.refetch()}/> : screens.data?.length ? <SavedRows screens={screens.data.slice(0,4)}/> : <Empty title="The desk is clear." body="Your completed screens will appear here once you run your first target-only or comparison screen."/>}</section>
  </Desk>;
}

export function History() {
  const screens = useListScreens(cookieRequest);
  const remove = useDeleteScreen(cookieRequest);
  const queryClient = useQueryClient();
  const [error,setError] = useState('');
  async function deleteOne(screen:SavedScreen) {
    if (!window.confirm(`Delete the report for ${screen.targetDomain}? This cannot be undone.`)) return;
    try { await remove.mutateAsync({id:screen.id}); await queryClient.invalidateQueries({queryKey:getListScreensQueryKey()}); } catch(cause) { setError(message(cause)); }
  }
  return <Desk section="Saved reports"><Heading eyebrow="02 / Archive" title="Saved reports." description="Your earlier screens, ready to reopen before the next seller conversation." action={<Link href="/workspace" className="desk-button" data-testid="link-new-screen">New screen <Plus size={16}/></Link>}/>
    {error && <div className="desk-alert">{error}</div>}
    {screens.isLoading ? <Loading/> : screens.isError ? <QueryState error={screens.error} retry={() => void screens.refetch()}/> : !screens.data?.length ? <Empty title="No reports saved yet." body="Run a screen to build your first brief." link="/workspace" linkText="Start a screen"/> :
      <div className="desk-panel"><span className="dl-eyebrow">{screens.data.length} saved briefs</span><div className="desk-list" style={{marginTop:18}}>{screens.data.map(screen => <div className="desk-row" key={screen.id}>
         <div><strong>{screen.targetDomain}</strong><small>{screenScope(screen)} · {dateLabel(screen.createdAt)}</small><ScreenSignals screen={screen}/></div>
        <div className="desk-row-actions"><Link href={`/history/${encodeURIComponent(screen.id)}`} data-testid={`link-open-screen-${screen.id}`}>Open brief</Link><button type="button" disabled={remove.isPending} onClick={() => void deleteOne(screen)} data-testid={`button-delete-screen-${screen.id}`} aria-label={`Delete ${screen.targetDomain}`}><Trash2 size={15}/></button></div>
      </div>)}</div></div>}
  </Desk>;
}

export function ReportDetail() {
  const {id = ''} = useParams<{id:string}>();
  const screen = useGetScreen(id,{...cookieRequest,query:{enabled:!!id,queryKey:getGetScreenQueryKey(id)}});
  const explanations = useListExplanations(id,{...cookieRequest,query:{enabled:!!id,queryKey:getListExplanationsQueryKey(id)}});
  const account = useGetAccount(cookieRequest);
  const create = useCreateExplanation(cookieRequest);
  const queryClient = useQueryClient();
  const form = useForm<{question:string}>({defaultValues:{question:''}});
  const [error,setError] = useState('');
  async function ask({question}:{question:string}) {
    if (question.trim().length < 5 || question.trim().length > 800) { setError('Ask a question between 5 and 800 characters.'); return; }
    setError('');
    try { await create.mutateAsync({data:{screenId:id,question:question.trim(),requestId:crypto.randomUUID()}}); form.reset(); await Promise.all([queryClient.invalidateQueries({queryKey:getListExplanationsQueryKey(id)}),queryClient.invalidateQueries({queryKey:getGetAccountQueryKey()})]); } catch(cause) {setError(message(cause));}
  }
  const canAsk = account.data && account.data.aiUsed < account.data.aiLimit;
  return <Desk section="Report">
     <Heading eyebrow="Saved brief / Review" title={screen.data?.targetDomain || 'Opening brief'} description={screen.data ? `${screenScope(screen.data)} · Saved ${dateLabel(screen.data.createdAt)}` : 'Review the evidence, then decide what to ask next.'} action={<button type="button" className="desk-button secondary" onClick={() => window.print()} disabled={!screen.data} data-testid="button-print-report"><Printer size={16}/> Print / save PDF</button>}/>
    {screen.isLoading ? <Loading/> : screen.isError ? <QueryState error={screen.error} retry={() => void screen.refetch()}/> : screen.data && <>
      <ScreenReport report={screen.data.report}/>
      <section className="desk-panel" style={{marginTop:40}}>
        <span className="dl-eyebrow">Evidence-grounded follow-up</span><h2 style={{marginTop:15}}>Ask about this brief.</h2>
        <p>Each question uses your saved report and makes one fresh Similarweb lookup. It consumes one AI question from your allowance; provider estimates remain directional, not proof of business performance.</p>
        <p className="desk-note">Sources in each answer include their source period and retrieval timestamp so you can distinguish the new lookup from the saved brief.</p>
        <p className="desk-note">{account.data ? `${account.data.aiUsed} of ${account.data.aiLimit} questions used · resets ${dateLabel(account.data.resetsAt)}` : 'Loading your question allowance…'}</p>
        <Form {...form}><form onSubmit={form.handleSubmit(ask)}><label className="desk-field">Your question<textarea {...form.register('question',{required:true})} rows={3} placeholder="What should I ask about the shift in traffic?" maxLength={800} data-testid="input-explanation-question"/></label><button type="submit" className="desk-button" style={{marginTop:16}} disabled={create.isPending || !canAsk} data-testid="button-ask-question">{create.isPending ? 'Preparing answer…' : 'Ask a question'} <ArrowRight size={16}/></button></form></Form>
        {account.data && !canAsk && <div className="desk-alert">Your question allowance has been used. It resets {dateLabel(account.data.resetsAt)}. <Link href="/plans">View plans</Link></div>}
        {error && <div className="desk-alert" role="alert">{error}</div>}
        <div style={{marginTop:35}}><span className="dl-eyebrow">Question history</span>
          {explanations.isLoading ? <Loading/> : explanations.isError ? <QueryState error={explanations.error} retry={() => void explanations.refetch()}/> : !explanations.data?.length ? <Empty title="No questions yet." body="Ask a specific question about the brief to build your research trail."/> : explanations.data.map(item => <article className="explanation" key={item.id}><span className="dl-eyebrow">{timestampLabel(item.createdAt)}</span><h3>{item.question}</h3><ExplanationAnswer answer={item.answer} id={item.id} citations={item.citations}/>{item.citations.length > 0 && <div><strong style={{fontSize:12}}>Sources and retrieval times</strong><ul>{item.citations.map((citation,index) => <li id={`citation-${item.id}-${index}`} key={index}><span className="source-number">[{index + 1}]</span> {safeUrl(citation.url) ? <a href={safeUrl(citation.url)!} target="_blank" rel="noopener noreferrer" data-testid={`link-citation-${item.id}-${index}`}>{citation.label}</a> : citation.label} · {citation.period} · Retrieved {timestampLabel(citation.retrievedAt)}</li>)}</ul></div>}</article>)}
        </div>
      </section>
    </>}
  </Desk>;
}

export function Compilations() {
  const compilations = useListCompilations(cookieRequest);
  const screens = useListScreens(cookieRequest);
  const create = useCreateCompilation(cookieRequest);
  const remove = useDeleteCompilation(cookieRequest);
  const queryClient = useQueryClient();
  const [,navigate] = useLocation();
  const form = useForm<{title:string}>({defaultValues:{title:''}});
  const [selected,setSelected] = useState<string[]>(() => new URLSearchParams(window.location.search).get('screenIds')?.split(',').filter(Boolean) ?? []);
  const [error,setError] = useState('');
  async function submit({title}:{title:string}) {
    if (!title.trim() || title.trim().length > 120 || !selected.length) {setError('Add a title and select at least one report.');return;}
    setError('');
    try {const result = await create.mutateAsync({data:{title:title.trim(),screenIds:selected}}); await queryClient.invalidateQueries({queryKey:getListCompilationsQueryKey()}); navigate(`/compilations/${encodeURIComponent(result.id)}`);} catch(cause) {setError(message(cause));}
  }
  async function deleteOne(id:string,title:string) {
    if (!window.confirm(`Delete compilation "${title}"? Its individual reports will remain saved.`)) return;
    try {await remove.mutateAsync({id}); await queryClient.invalidateQueries({queryKey:getListCompilationsQueryKey()});} catch(cause) {setError(message(cause));}
  }
   return <Desk section="Compilations"><Heading eyebrow="03 / Cross-report research" title="Compilations." description="Bring saved briefs together to see the bigger picture across the businesses you're studying."/><div className="desk-grid"><section className="desk-panel"><span className="dl-eyebrow">Create a compilation</span><h2 style={{marginTop:15}}>Build a research set.</h2><Form {...form}><form onSubmit={form.handleSubmit(submit)}><label className="desk-field" style={{margin:'22px 0'}}>Title<input {...form.register('title',{required:true})} placeholder="A name for this research set" maxLength={120} data-testid="input-compilation-title"/></label><span className="dl-eyebrow">Select saved reports</span>{screens.isLoading ? <Loading/> : screens.isError ? <QueryState error={screens.error} retry={() => void screens.refetch()}/> : screens.data?.length ? screens.data.map(screen => <label className="desk-check" key={screen.id}><input type="checkbox" checked={selected.includes(screen.id)} onChange={event => setSelected(current => event.target.checked ? [...current,screen.id] : current.filter(id => id !== screen.id))} data-testid={`checkbox-screen-${screen.id}`}/><span>{screen.targetDomain} <small style={{display:'block',color:'#839082'}}>{screen.comparisonDomains?.length ? `vs ${screen.comparisonDomains.join(', ')}` : 'Target only'}</small></span></label>) : <p>No saved reports yet. <Link href="/workspace">Run a screen</Link> to start a compilation.</p>}<button type="submit" className="desk-button" style={{marginTop:22}} disabled={create.isPending || !screens.data?.length} data-testid="button-create-compilation">{create.isPending ? 'Compiling…' : 'Create compilation'} <ArrowRight size={16}/></button></form></Form>{error && <div className="desk-alert" role="alert">{error}</div>}</section><aside className="desk-panel"><span className="dl-eyebrow">Research note</span><h2 style={{marginTop:18}}>Keep the threads together.</h2><p>A compilation summarizes selected saved reports. Every source brief remains available to inspect independently, including its limitations and seller questions.</p></aside></div><section style={{marginTop:65}}><span className="dl-eyebrow">Saved sets</span><h2 style={{fontSize:38,fontWeight:500,letterSpacing:'-.05em'}}>Your compilations</h2>{compilations.isLoading ? <Loading/> : compilations.isError ? <QueryState error={compilations.error} retry={() => void compilations.refetch()}/> : !compilations.data?.length ? <Empty title="No sets assembled yet." body="Select one or more saved reports above to create a compilation."/> : <div className="desk-list">{compilations.data.map(item => <div className="desk-row" key={item.id}><div><strong>{item.title}</strong><small>{item.screenIds.length} reports · {dateLabel(item.createdAt)}</small></div><div className="desk-row-actions"><Link href={`/compilations/${encodeURIComponent(item.id)}`} data-testid={`link-compilation-${item.id}`}>Open compilation</Link><button type="button" onClick={() => void deleteOne(item.id,item.title)} disabled={remove.isPending} aria-label={`Delete ${item.title}`} data-testid={`button-delete-compilation-${item.id}`}><Trash2 size={15}/></button></div></div>)}</div>}</section></Desk>;
}

export function CompilationDetailPage() {
  const {id = ''} = useParams<{id:string}>();
  const compilation = useGetCompilation(id,{...cookieRequest,query:{enabled:!!id,queryKey:getGetCompilationQueryKey(id)}});
  const remove = useDeleteCompilation(cookieRequest);
  const queryClient = useQueryClient();
  const [,navigate] = useLocation();
  const [error,setError] = useState('');
  async function deleteThis() {
    if (!window.confirm('Delete this compilation? Saved reports will remain available.')) return;
    try {await remove.mutateAsync({id}); await queryClient.invalidateQueries({queryKey:getListCompilationsQueryKey()}); navigate('/compilations');} catch(cause) {setError(message(cause));}
  }
  return <Desk section="Compilation"><Heading eyebrow="Research compilation" title={compilation.data?.title || 'Opening compilation'} description={compilation.data ? `${compilation.data.screenIds.length} saved reports · Compiled ${dateLabel(compilation.data.createdAt)}` : 'Connecting your research.'} action={<button className="desk-button secondary" type="button" disabled={!compilation.data} onClick={() => window.print()} data-testid="button-print-compilation"><Printer size={16}/> Print / save PDF</button>}/>{error && <div className="desk-alert">{error}</div>}{compilation.isLoading ? <Loading/> : compilation.isError ? <QueryState error={compilation.error} retry={() => void compilation.refetch()}/> : compilation.data && <><div className="desk-panel" style={{background:'#e0e9d2'}}><span className="dl-eyebrow">Cross-report readout</span><h2 style={{fontFamily:'var(--app-font-serif)',fontSize:42,marginTop:18}}>What the reports suggest</h2><p style={{fontSize:17,whiteSpace:'pre-wrap',color:'#35473b'}}>{compilation.data.summary || 'No cross-report summary was returned.'}</p></div><section className="desk-panel"><span className="dl-eyebrow">Source briefs</span>{compilation.data.screens.length ? <SavedRows screens={compilation.data.screens}/> : <Empty title="No reports available." body="The source reports for this compilation are no longer available."/>}</section><button type="button" className="desk-button danger" onClick={() => void deleteThis()} disabled={remove.isPending} data-testid="button-delete-this-compilation"><Trash2 size={15}/> Delete compilation</button></>}</Desk>;
}

export function Plans() {
  const account = useGetAccount(cookieRequest);
  const catalog = useListPlans(cookieRequest);
  const checkout = useCreateCheckout(cookieRequest);
  const portal = useCreatePortal(cookieRequest);
  const mode = catalog.data?.billingStatus.mode ?? 'unavailable';
  const modeLabel = mode === 'live' ? 'live' : 'test';
  const [error,setError] = useState('');
  const billingReturn = new URLSearchParams(window.location.search).get('billing');
  const queryClient = useQueryClient();
  useEffect(() => {
    if (billingReturn !== 'success') return;
    // Webhooks can arrive after Stripe redirects. Refresh the allowance briefly
    // rather than implying a successful redirect alone has granted a paid tier.
    const interval = window.setInterval(() => {
      void queryClient.invalidateQueries({queryKey:getGetAccountQueryKey()});
    }, 3000);
    const timeout = window.setTimeout(() => window.clearInterval(interval), 30000);
    return () => { window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [billingReturn, queryClient]);
  async function begin(tier:'pro'|'team'|'enterprise') {setError('');try {const result = await checkout.mutateAsync({data:{tier}});const url = safeUrl(result.url); if (!url) throw new Error('Billing returned an invalid link.'); window.location.assign(url);} catch(cause) {setError(message(cause));}}
  async function manage() {setError('');try {const result = await portal.mutateAsync();const url = safeUrl(result.url);if (!url) throw new Error('Billing returned an invalid link.');window.location.assign(url);} catch(cause) {setError(message(cause));}}
  return <Desk section="Plans & usage">
    <Heading eyebrow="04 / Account" title="Plans & usage." description="Know what your research allowance covers, and when it renews."/>
     {billingReturn === 'success' && <div className="desk-alert" role="status">Stripe checkout returned. Your plan and allowance will update only after Stripe confirms payment; this may take a moment.</div>}
     {billingReturn === 'cancelled' && <div className="desk-alert" role="status">Checkout was cancelled. Your plan was not changed.</div>}
    {error && <div className="desk-alert" role="alert">{error}</div>}
    <section className="desk-panel"><span className="dl-eyebrow">Current allowance</span>
      {account.isLoading ? <Loading/> : account.isError ? <QueryState error={account.error} retry={() => void account.refetch()}/> : account.data && <div className="desk-grid" style={{marginTop:20}}>
        <div><h2>{account.data.tier.toUpperCase()} plan</h2><p>Your usage resets on {dateLabel(account.data.resetsAt)}.</p><div style={{marginTop:30}}><strong>Screen units · {account.data.screensUsed} of {account.data.screenLimit}</strong><div className="desk-meter"><span style={{width:`${Math.min(100,account.data.screenLimit ? account.data.screensUsed/account.data.screenLimit*100 : 0)}%`}}/></div><strong>AI questions · {account.data.aiUsed} of {account.data.aiLimit}</strong><div className="desk-meter"><span style={{width:`${Math.min(100,account.data.aiLimit ? account.data.aiUsed/account.data.aiLimit*100 : 0)}%`}}/></div></div><p className="desk-note">A target-only screen or a target with one peer uses one screen unit. On Enterprise, each additional peer uses one more unit (up to 19 peers).</p></div>
         <div><p>{!account.data.billingEnabled ? 'Billing is not ready in this environment. You can still review your allowance.' : account.data.hasBillingCustomer ? `Manage your Stripe ${modeLabel} subscription and payment methods.` : `Start a ${modeLabel} checkout to create a billing profile before using the billing portal.`}</p><button type="button" className="desk-button secondary" disabled={!account.data.billingEnabled || !account.data.hasBillingCustomer || portal.isPending} onClick={() => void manage()} data-testid="button-manage-billing">{portal.isPending ? 'Opening…' : `Manage ${modeLabel} billing`} <ArrowRight size={15}/></button></div>
      </div>}
    </section>
    <section style={{marginTop:60}}><span className="dl-eyebrow">Available plans</span><h2 style={{fontSize:40,fontWeight:500,letterSpacing:'-.05em'}}>Choose your research capacity.</h2>
      {catalog.isLoading ? <Loading/> : catalog.isError ? <QueryState error={catalog.error} retry={() => void catalog.refetch()}/> : <>
        <div className="dl-pricing-grid" style={{marginTop:30}}>{catalog.data?.plans.map(plan => <article className="dl-price" key={plan.tier}>
          <span className="dl-eyebrow">{plan.tier}</span><h3>{plan.name}</h3><strong>{priceLabel(plan.tier,plan.monthlyPrice,plan.monthlyPriceDisplay)}</strong>
          <p>{plan.screenLimit} screen units and {plan.aiLimit} AI questions per period.</p>
           {account.data?.tier === plan.tier ? <span style={{marginTop:'auto',fontWeight:700}}>Current plan</span> : plan.tier === 'free' ? <span style={{marginTop:'auto'}}>Included entry plan</span> : <button type="button" className="desk-button" style={{marginTop:'auto'}} disabled={!account.data?.billingEnabled || !plan.checkoutAvailable || checkout.isPending} onClick={() => void begin(plan.tier as 'pro'|'team'|'enterprise')} data-testid={`button-checkout-${plan.tier}`}>{checkout.isPending ? 'Opening checkout…' : !account.data?.billingEnabled ? 'Billing unavailable' : !plan.checkoutAvailable ? 'Checkout unavailable' : mode === 'live' ? 'Subscribe — real payment' : 'TEST checkout'} <ArrowRight size={15}/></button>}
        </article>)}</div>
         <p className="desk-note" role="status">{catalog.data?.billingStatus.enabled ? (mode === 'live' ? 'Live Stripe prices and webhook verified. Checkout will charge real customers.' : 'Stripe sandbox connected: test prices and webhook verified. Test checkout is available in this preview.') : `${mode === 'live' ? 'Live' : 'Test'} checkout is unavailable. ${catalog.data?.billingStatus.limitation || 'Check the connection, approved prices, and webhook configuration.'}`}</p>
         <p className="desk-note">{mode === 'live' ? 'Subscriptions shown here bill monthly in USD. Opening checkout and completing payment will charge your card.' : 'Stripe TEST mode in this preview. No live charge will be made. Publishing requires a separate live Stripe connection.'}</p><p className="desk-note">{catalog.data?.note}</p>{account.data && !account.data.billingEnabled && <p className="desk-note">Checkout is disabled until billing is ready. Your current allowance remains available.</p>}
      </>}
    </section>
  </Desk>;
}