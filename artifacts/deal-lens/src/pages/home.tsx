import { useState } from 'react';
import { ArrowRight, AlertCircle, ArrowUpRight, FileSearch2, LockKeyhole, Printer, ScanSearch, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { useScreen } from '@/hooks/use-screen';
import { ScreenReport } from '@/components/screen-report';
import type { ScreenInput } from '@workspace/api-client-react';

function normalizeDomain(value: string) {
  const trimmed = value.trim().toLowerCase();
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return trimmed;
  }
}

function isDomain(value: string) {
  const normalized = normalizeDomain(value);
  return normalized.length >= 4 && normalized.length <= 253 && /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized);
}

const screenSchema = z.object({
  targetDomain: z.string().trim().min(1, 'Enter the target domain.').refine(isDomain, 'Enter a valid domain, such as example.com.'),
  comparisonDomain: z.string().trim().min(1, 'Enter a comparison domain.').refine(isDomain, 'Enter a valid domain, such as peer.com.'),
}).refine(data => normalizeDomain(data.targetDomain) !== normalizeDomain(data.comparisonDomain), {
  message: 'Choose a different domain for comparison.',
  path: ['comparisonDomain'],
});

type ScreenFormValues = z.infer<typeof screenSchema>;

export default function Home() {
  const { report, runScreen, isPending, isError, error, resetError } = useScreen();
  const [lastInput, setLastInput] = useState<ScreenInput | null>(null);
  const form = useForm<ScreenFormValues>({
    resolver: zodResolver(screenSchema),
    defaultValues: { targetDomain: '', comparisonDomain: '' },
    mode: 'onSubmit',
  });

  async function submit(values: ScreenFormValues) {
    const input = { targetDomain: normalizeDomain(values.targetDomain), comparisonDomain: normalizeDomain(values.comparisonDomain) };
    setLastInput(input);
    resetError();
    try {
      await runScreen(input);
      window.setTimeout(() => document.getElementById('report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch {
      // The generated mutation exposes the failure in the inline error state.
    }
  }

  async function retry() {
    if (!lastInput) return;
    resetError();
    try {
      await runScreen(lastInput);
    } catch {
      // Keep the error visible so the user can revise the domains or try again.
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="#top" className="brand" aria-label="DealLens home" data-testid="link-home">
          <span className="brand-mark"><ScanSearch size={19} strokeWidth={1.8} /></span>
          <span className="brand-name">deal<span>lens</span><span style={{ color: '#e9e6da' }}>.</span></span>
        </a>
        <div className="sidebar-label eyebrow">Workspace</div>
        <a href="#screen-form" className="nav-item" data-testid="link-traffic-screen"><FileSearch2 size={17} /> Traffic screen</a>
        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <strong><span className="note-dot" />First-pass intelligence</strong>
          Directional signals for better diligence conversations. Not a fraud determination or investment recommendation.
        </div>
      </aside>
      <main className="main" id="top">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span>/</span><strong>Traffic screen</strong></div>
          <div className="topbar-right"><i /> Acquisition diligence</div>
        </header>
        <div className="content">
          <div className="intro">
            <div>
              <span className="eyebrow" style={{ color: '#c66241' }}>The diligence desk / 01</span>
              <h1>See the traffic.<br /><em>Ask better questions.</em></h1>
              <p>Compare a target with a peer, surface what deserves a closer look, and walk into the seller conversation prepared.</p>
            </div>
            {report && <button type="button" className="print-button" onClick={() => window.print()} data-testid="button-print-report"><Printer size={15} /> Print / save PDF <ArrowUpRight size={13} /></button>}
          </div>

          <section className="input-panel" id="screen-form" aria-label="New traffic screen">
            <div className="input-heading"><h2><ScanSearch size={20} /> Set up a screen</h2><span>Two domains. One focused starting point.</span></div>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(submit)} noValidate>
                <div className="input-grid">
                  <FormField control={form.control} name="targetDomain" render={({ field }) => (
                    <FormItem className="field">
                      <label htmlFor="target-domain">01 / Target domain</label>
                      <FormControl><input {...field} id="target-domain" className="domain-input" placeholder="targetcompany.com" autoComplete="url" spellCheck={false} aria-label="Target domain" data-testid="input-target-domain" /></FormControl>
                      <FormMessage className="form-error" />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="comparisonDomain" render={({ field }) => (
                    <FormItem className="field">
                      <label htmlFor="comparison-domain">02 / Comparison domain</label>
                      <FormControl><input {...field} id="comparison-domain" className="domain-input" placeholder="comparablecompany.com" autoComplete="url" spellCheck={false} aria-label="Comparison domain" data-testid="input-comparison-domain" /></FormControl>
                      <FormMessage className="form-error" />
                    </FormItem>
                  )} />
                  <button type="submit" className="run-button" disabled={isPending} data-testid="button-run-screen">{isPending ? 'Screening…' : 'Run screen'} <ArrowRight size={17} /></button>
                </div>
              </form>
            </Form>
            <div className="form-meta"><LockKeyhole size={13} /> A live screen uses provider credits. Results are estimates, not first-party analytics.</div>
          </section>

          <div id="report" aria-live="polite">
            {isPending ? (
              <>
                <div className="divider-heading"><span /><p className="eyebrow">Building your brief</p><span /></div>
                <div className="loading-state" data-testid="status-loading"><h3>Gathering the signals.</h3><p>Pulling recent traffic estimates and assembling an evidence-constrained readout. This may take a moment.</p><div className="skeleton small" /><div className="skeleton large" /><div className="skeleton medium" /><div className="skeleton" style={{ width: '79%' }} /><div className="skeleton" style={{ width: '56%' }} /></div>
              </>
            ) : isError ? (
              <>
                <div className="divider-heading"><span /><p className="eyebrow">Screen unavailable</p><span /></div>
                <div className="error-state" role="alert" data-testid="status-error"><AlertCircle size={22} /><div><h3>We couldn't complete this screen.</h3><p>{error instanceof Error && error.message ? error.message : 'The data sources may be temporarily unavailable. Check the domains and try again.'}</p><button type="button" className="retry" onClick={retry} data-testid="button-retry-screen">Try again</button></div></div>
              </>
            ) : report ? <ScreenReport report={report} /> : (
              <>
                <div className="divider-heading"><span /><p className="eyebrow">Your report will appear here</p><span /></div>
                <div className="empty-state" data-testid="status-empty">
                  <div className="empty-copy">
                    <span className="eyebrow" style={{ color: '#d26848' }}>Ready when you are</span>
                    <h2>A clearer picture starts with a comparison.</h2>
                    <p>Enter the business you're evaluating and a relevant peer. We'll turn recent traffic estimates into focused diligence prompts.</p>
                  </div>
                  <div className="empty-art" aria-hidden="true"><div className="art-card"><div className="art-line"><svg viewBox="0 0 190 62" preserveAspectRatio="none"><polyline points="0,47 24,39 47,45 73,19 95,27 121,13 146,28 170,11 190,16" fill="none" stroke="#d96d4b" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></div><div className="art-stamp"><ScanSearch size={31} strokeWidth={1.6} /></div></div></div>
                </div>
              </>
            )}
          </div>

          <footer className="footer"><span>DealLens / first-pass traffic intelligence</span><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={13} /> Verify every signal with seller data</span></footer>
        </div>
      </main>
    </div>
  );
}