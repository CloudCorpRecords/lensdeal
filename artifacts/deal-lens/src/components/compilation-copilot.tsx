import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Form } from '@/components/ui/form';
import { ExplanationAnswer } from '@/components/explanation-answer';
import { getGetAccountQueryKey, getListCopilotAnswersQueryKey, useAskCopilot, useGetAccount, useListCopilotAnswers } from '@workspace/api-client-react';

function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') return data.error;
  }
  return error instanceof Error ? error.message : 'The answer could not be saved. Try again.';
}
function safeUrl(value: string) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function timestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', {dateStyle:'medium', timeStyle:'short'}).format(date);
}

export function CompilationCopilot({ id, screenCount, activeAnswerId, onSelectAnswer }: { id: string; screenCount: number; activeAnswerId: string | null; onSelectAnswer: (answer: {id:string; reportIds:string[]} | null) => void }) {
  const answers = useListCopilotAnswers(id, {query:{enabled:!!id, queryKey:getListCopilotAnswersQueryKey(id)}, request:{credentials:'include'}});
  const account = useGetAccount({request:{credentials:'include'}});
  const ask = useAskCopilot({request:{credentials:'include'}});
  const queryClient = useQueryClient();
  const form = useForm<{question:string}>({defaultValues:{question:''}});
  const pendingRequest = useRef<{question:string; requestId:string} | null>(null);
  const [error, setError] = useState('');
  const canAsk = !!account.data && account.data.aiUsed < account.data.aiLimit;
  const retrySameQuestion = pendingRequest.current?.question === form.watch('question').trim();
  const withinReportLimit = screenCount >= 1 && screenCount <= 6;
  async function submit({question}: {question:string}) {
    const trimmed = question.trim();
    if (trimmed.length < 5 || trimmed.length > 800) { setError('Write a question between 5 and 800 characters.'); return; }
    // A previously sent request may have completed server-side despite a lost response.
    // Replaying its original request ID retrieves that result without a new charge.
    if (!canAsk && pendingRequest.current?.question !== trimmed) { setError('No AI questions are available for a new request. Check your plan allowance.'); return; }
    if (!withinReportLimit && pendingRequest.current?.question !== trimmed) { setError('Copilot questions require a compilation of 1–6 saved reports. Create a smaller research set to ask a new question.'); return; }
    setError('');
    if (pendingRequest.current?.question !== trimmed) pendingRequest.current = {question:trimmed, requestId:crypto.randomUUID()};
    try {
      await ask.mutateAsync({id, data:pendingRequest.current});
      pendingRequest.current = null;
      form.reset();
      await Promise.all([
        queryClient.invalidateQueries({queryKey:getListCopilotAnswersQueryKey(id)}),
        queryClient.invalidateQueries({queryKey:getGetAccountQueryKey()})
      ]);
    } catch (cause) { setError(`${errorText(cause)} Retrying the same question uses the same request ID.`); }
  }
  return <section className="copilot" aria-labelledby="copilot-title" data-testid="section-compilation-copilot">
    <div className="copilot-intro">
      <div><span className="dl-eyebrow">Research copilot / On demand</span><h2 id="copilot-title">A better question changes the deal.</h2><p>Ask about the companies in this compilation. Answers are grounded in saved reports with numbered sources; a fresh Similarweb lookup may also be used when needed. The answer tells you which.</p></div>
      <div className="copilot-cost" data-testid="status-copilot-allowance"><strong>01 AI question</strong>per submission<br/>{account.isLoading ? 'Checking allowance…' : account.isError ? 'Allowance unavailable' : account.data ? `${Math.max(0,account.data.aiLimit-account.data.aiUsed)} remaining · resets ${timestamp(account.data.resetsAt)}` : 'Allowance unavailable'}</div>
    </div>
    <Form {...form}><form className="copilot-form" onSubmit={form.handleSubmit(submit)}>
      <p className="copilot-scope" role="status" data-testid="status-copilot-report-scope">Copilot question scope: 1–6 saved reports. This compilation contains {screenCount} {screenCount === 1 ? 'report' : 'reports'}.{!withinReportLimit ? ' Create a compilation within that limit before asking a new question.' : ''}</p>
      <label htmlFor="copilot-question">Your question for the research desk</label>
      <textarea id="copilot-question" {...form.register('question',{required:true})} placeholder="Which traffic shifts should I verify with the seller, and what would explain them?" maxLength={800} onChange={event => { form.register('question').onChange(event); if (pendingRequest.current?.question !== event.target.value.trim()) pendingRequest.current = null; }} data-testid="input-copilot-question"/>
      <div className="copilot-form-footer"><p>One AI question is charged for each new request. Retrying an uncertain result with the same request ID does not create a new question. Fresh Similarweb data is disclosed with every answer.</p><button type="submit" className="desk-button" disabled={ask.isPending || ((!canAsk || !withinReportLimit) && !retrySameQuestion)} data-testid="button-ask-copilot">{ask.isPending ? 'Reviewing evidence…' : retrySameQuestion ? 'Retry same request' : 'Ask the copilot'} <ArrowRight size={16}/></button></div>
      {account.isError && <div className="desk-alert" role="alert">Could not check your question allowance. <button type="button" onClick={() => void account.refetch()} data-testid="button-retry-copilot-account">Try again</button></div>}
      {account.data && !canAsk && <div className="desk-alert" role="status">Your AI question allowance is used. {retrySameQuestion ? 'You can retry the pending question with its original request ID; new questions remain unavailable.' : `It resets ${timestamp(account.data.resetsAt)}.`} <Link href="/plans" data-testid="link-copilot-plans">View plans</Link></div>}
      {error && <div className="desk-alert" role="alert" data-testid="status-copilot-error">{error}</div>}
    </form></Form>
    <div className="copilot-history">
      <div className="copilot-history-header"><h3>Question history</h3><span data-testid="text-copilot-answer-count">{answers.data?.length ?? 0} saved {answers.data?.length === 1 ? 'answer' : 'answers'}</span></div>
      {answers.isLoading ? <div aria-label="Loading saved answers"><div className="desk-skeleton"/><div className="desk-skeleton"/></div> : answers.isError ? <div className="desk-alert" role="alert">Could not load saved answers: {errorText(answers.error)} <button type="button" onClick={() => void answers.refetch()} data-testid="button-retry-copilot-answers">Try again</button></div> : !answers.data?.length ? <div className="desk-empty"><span className="dl-eyebrow">An open line of inquiry</span><h3>Start with what you need to verify.</h3><p>Your cited answers will collect here as a record of the questions you asked.</p></div> : [...answers.data].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map((item, index) => <article className="copilot-item" key={item.id} data-testid={`card-copilot-answer-${item.id}`}>
        <div className="copilot-item-date">NO. {String(answers.data!.length-index).padStart(2,'0')}<br/>{timestamp(item.createdAt)}</div>
        <div><h4 data-testid={`text-copilot-question-${item.id}`}>{item.question}</h4><button type="button" className="copilot-select" aria-pressed={activeAnswerId === item.id} onClick={() => onSelectAnswer(activeAnswerId === item.id ? null : {id:item.id, reportIds:[...new Set(item.citations.flatMap(citation => citation.reportId ? [citation.reportId] : []))]})} data-testid={`button-select-copilot-answer-${item.id}`}>{activeAnswerId === item.id ? 'Selected answer · clear evidence highlight' : 'Show cited reports in evidence atlas'}</button><span className="copilot-lookup" data-testid={`status-copilot-lookup-${item.id}`}>{item.freshLookup ? 'Fresh Similarweb lookup used' : 'Saved reports only · no fresh Similarweb lookup'}</span><ExplanationAnswer answer={item.answer} id={`copilot-${item.id}`} citations={item.citations.map(citation => ({label:citation.label,url:citation.sourceUrl,period:citation.period,retrievedAt:citation.retrievedAt}))}/>
        <div className="copilot-sources"><strong>Sources & retrieval times</strong>{item.citations.length ? <ol>{item.citations.map((citation, citationIndex) => <li id={`citation-copilot-${item.id}-${citationIndex}`} key={citationIndex} data-testid={`text-copilot-citation-${item.id}-${citationIndex}`}>{safeUrl(citation.sourceUrl) ? <a href={safeUrl(citation.sourceUrl)!} target="_blank" rel="noopener noreferrer" data-testid={`link-copilot-citation-${item.id}-${citationIndex}`}>{citation.label}</a> : citation.label} · {citation.domain} · {citation.period || 'Period unavailable'} · Retrieved {timestamp(citation.retrievedAt)} · {citation.reportId ? <Link href={`/history/${encodeURIComponent(citation.reportId)}`} data-testid={`link-copilot-report-${item.id}-${citationIndex}`}>Saved report</Link> : 'Fresh source'}</li>)}</ol> : <p className="desk-note">No source records accompanied this answer. Verify its claims before use.</p>}</div></div>
      </article>)}
    </div>
  </section>;
}