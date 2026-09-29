import type { ReactNode } from 'react';

type Citation = { label: string; url: string; period: string; retrievedAt: string };

function inlineText(text: string, explanationId: string, citations: Citation[]): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    const match = /^\[(\d+)\]$/.exec(part);
    const source = match ? Number(match[1]) - 1 : -1;
    return source >= 0 && source < citations.length
      ? <a key={index} href={`#citation-${explanationId}-${source}`} aria-label={`See source ${source + 1}`}>{part}</a>
      : part;
  });
}

export function ExplanationAnswer({ answer, id, citations }: { answer: string; id: string; citations: Citation[] }) {
  return <div className="explanation-answer">
    {answer.split('\n').map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      const heading = /^#{1,3}\s+(.+)$/.exec(trimmed);
      if (heading) return <h4 key={index}>{inlineText(heading[1], id, citations)}</h4>;
      const boldHeading = /^\*\*([^*]+)\*\*$/.exec(trimmed);
      if (boldHeading) return <h4 key={index}>{boldHeading[1]}</h4>;
      const bullet = /^[*-]\s+(.+)$/.exec(trimmed);
      if (bullet) return <div className="explanation-point" key={index}><span aria-hidden="true">•</span><p>{inlineText(bullet[1], id, citations)}</p></div>;
      return <p key={index}>{inlineText(trimmed, id, citations)}</p>;
    })}
  </div>;
}