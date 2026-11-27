import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { ArrowRight, Bot, Check, Download, LoaderCircle, RotateCcw, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAdmin } from '@/lib/admin-store';
import { adminAssistantDecision, adminAssistantMessage } from '@/lib/admin-assistant.functions';
import { ADMIN_ROUTES, type AssistantAction, type AssistantProposal, type AssistantReply, type AssistantView, type Json } from '@/lib/admin-assistant-policy';

/*
 * The admin assistant is temporary by design: the conversation, its short-term
 * memory and any unconfirmed preview live only in this component's memory.
 * Closing the panel (or reloading the page) wipes them; nothing is written to
 * localStorage, sessionStorage, IndexedDB, cookies or the database. Saved
 * business changes (bookings, blocks, …) are of course kept.
 */

type Message = { role: 'user' | 'assistant'; content: string; view?: AssistantView; actions?: AssistantAction[]; undo?: boolean };
// Free dictation built into the phone/browser (no paid voice service).
type Dictation = { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };
const dictationCtor = (): (new () => Dictation) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Dictation; webkitSpeechRecognition?: new () => Dictation };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const EXAMPLES = ['Who is booked today?', 'Which timings did I block?', 'How much did we earn this week?', 'Who is working tomorrow?', 'Help'];

/** Read aloud naturally: the headline, not a long list; prices as rupees. */
function spoken(text: string) {
  const lines = text.split('\n').filter(Boolean);
  const head = lines.length > 4 ? [...lines.slice(0, 3), `and ${lines.length - 3} more on the screen`] : lines;
  return head.join('. ').replace(/•/g, '').replace(/^\d+\.\s*/gm, '').replace(/₹\s?([\d,]+)/g, '$1 rupees').replace(/\s*[–—]\s*/g, ' to ').replace(/·/g, ', ').replace(/\s+/g, ' ');
}

export function AdminAssistant() {
  const { pin, refresh } = useAdmin();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<AssistantProposal>();
  const [sound, setSound] = useState(false);
  const [download, setDownload] = useState<AssistantReply['download']>();
  const [listening, setListening] = useState(false);
  const dictation = useRef<Dictation | null>(null);
  const lastViaVoice = useRef(false);
  const context = useRef<Json | undefined>(undefined);
  const conversation = useRef('');
  const bottom = useRef<HTMLDivElement>(null);
  const submitLock = useRef(false);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const proposalRef = useRef(proposal);
  proposalRef.current = proposal;

  function navigateTo(a: AssistantAction) {
    // only real admin pages, and only by the admin's own request
    if (!(ADMIN_ROUTES as readonly string[]).includes(a.to)) return;
    void router.navigate({ to: a.to, ...(a.search ? { search: a.search } : {}) } as never);
  }

  function applyReply(reply: AssistantReply, speak = false) {
    const viaVoice = lastViaVoice.current;
    lastViaVoice.current = false;
    if (reply.context !== undefined) context.current = reply.context;
    setMessages(m => [...m, { role: 'assistant', content: reply.text, ...(reply.view ? { view: reply.view } : {}), ...(reply.actions?.length ? { actions: reply.actions } : {}), ...(reply.undo || /^Saved\./.test(reply.text) ? { undo: !/^Saved\. Undo/.test(reply.text) } : {}) }]);
    setProposal(reply.proposal);
    if (reply.download) setDownload(reply.download);
    if (reply.navigate) navigateTo(reply.navigate);
    if (speak && soundRef.current && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(spoken(reply.text));
      utterance.lang = 'en-IN';
      // hands-free: after asking "Should I confirm?", listen for yes / no
      if (reply.proposal && viaVoice) utterance.onend = () => listen();
      window.speechSynthesis.speak(utterance);
    } else if (reply.proposal && viaVoice) listen();
    refresh();
    void router.invalidate();
  }

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages, proposal, open]);
  useEffect(() => () => { window.speechSynthesis?.cancel(); dictation.current?.stop(); }, []);

  async function send(said?: string) {
    const input = (said ?? text).trim();
    if (!input || submitLock.current) return;
    submitLock.current = true;
    if (!conversation.current) conversation.current = crypto.randomUUID();
    const next: Message[] = [...messages, { role: 'user', content: input }];
    setMessages(next); setText(''); setBusy(true); setProposal(undefined);
    try {
      applyReply(await adminAssistantMessage({ data: { pin, conversationId: conversation.current, messages: next.slice(-20).map(m => ({ role: m.role, content: m.content })), ...(context.current !== undefined ? { context: context.current } : {}) } }), true);
    } catch { applyReply({ text: 'Could not reach the assistant. Your request is still above; no unconfirmed changes were saved.' }); }
    finally { setBusy(false); submitLock.current = false; }
  }
  async function decide(decision: 'confirm' | 'cancel') {
    if (!proposal || submitLock.current) return;
    submitLock.current = true; setBusy(true);
    try { applyReply(await adminAssistantDecision({ data: { pin, id: proposal.id, decision } }), true); }
    catch { applyReply({ text: 'Could not confirm the outcome. Check the admin page before trying again.' }); }
    finally { setBusy(false); submitLock.current = false; }
  }

  /** Close = forget everything: messages, memory, previews (cancelled on the server too), mic and voice. */
  function close() {
    dictation.current?.stop();
    window.speechSynthesis?.cancel();
    const pendingId = proposalRef.current?.id;
    if (pendingId) void adminAssistantDecision({ data: { pin, id: pendingId, decision: 'cancel' } }).catch(() => {});
    setOpen(false);
    setMessages([]); setProposal(undefined); setDownload(undefined); setText(''); setListening(false); setBusy(false);
    context.current = undefined;
    conversation.current = '';
    submitLock.current = false;
  }

  function listen() {
    const C = dictationCtor();
    if (!C) return;
    if (listening) { dictation.current?.stop(); return; }
    window.speechSynthesis?.cancel();
    const r = new C(); r.lang = 'en-IN'; r.interimResults = false;
    r.onresult = e => { const s = Array.from(e.results).map(x => x[0]?.transcript ?? '').join(' ').trim(); if (s) { lastViaVoice.current = true; void send(s); } };
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    dictation.current = r; setListening(true);
    try { r.start(); } catch { setListening(false); }
  }
  function saveDownload() {
    if (!download) return;
    const url = URL.createObjectURL(new Blob([download.csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = download.filename; a.click(); URL.revokeObjectURL(url);
  }

  const lastIndex = messages.length - 1;
  return <>
    {!open && <Button className="fixed right-4 bottom-20 z-40 gap-2 shadow-lg md:right-6 md:bottom-6" onClick={() => setOpen(true)} aria-label="Open admin assistant"><Bot />Assistant</Button>}
    <section aria-label="Admin assistant" className={open ? 'fixed inset-x-3 bottom-3 z-50 flex h-[min(720px,calc(100dvh-24px))] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl md:right-5 md:left-auto md:w-[440px]' : 'hidden'}>
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3"><Bot className="size-5 text-bronze" /><div><h2 className="font-display text-2xl">Salon assistant</h2><p className="text-xs text-muted-foreground">Nothing is saved until you confirm · closing clears this chat</p></div></div>
        <div className="flex gap-1"><Button variant="ghost" size="icon" title="Close assistant" aria-label="Close assistant" onClick={close}><X /></Button></div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5" aria-live="polite">
        {!messages.length && <><p className="font-display text-2xl leading-snug">What would you like to do?</p><p className="mt-2 text-sm text-muted-foreground">Ask or say it normally, e.g. “which timings did I block?”, “block Kiran tomorrow 2 to 4 pm”, “who is coming at 4?”, “open the calendar”.</p><div className="mt-4 flex flex-wrap gap-2">{EXAMPLES.map(x => <Button key={x} variant="outline" size="sm" disabled={busy} onClick={() => void send(x)}>{x}</Button>)}</div></>}
        <div className="space-y-5">{messages.map((m, i) => m.role === 'user'
          ? <div key={i} className="ml-8 border-l-2 border-bronze pl-3"><p className="mb-1 text-xs font-medium text-muted-foreground">You</p><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.content}</p></div>
          : <div key={i} className="mr-1">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Assistant</p>
              {m.view ? <><p className="break-words text-sm leading-relaxed">{m.content.split('\n')[0]}</p><ViewCard view={m.view} /></> : <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.content}</p>}
              {(m.actions?.length || (m.undo && i === lastIndex)) ? <div className="mt-3 flex flex-wrap gap-2">
                {m.actions?.map((a, k) => <Button key={k} variant="outline" size="sm" className="gap-1" onClick={() => navigateTo(a)}>{a.label}<ArrowRight className="size-3.5" /></Button>)}
                {m.undo && i === lastIndex && <Button variant="outline" size="sm" className="gap-1" disabled={busy} onClick={() => void send('undo')}><RotateCcw className="size-3.5" />Undo</Button>}
              </div> : null}
            </div>)}</div>
        {busy && <p role="status" className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />Checking…</p>}
        {proposal && <div className="mt-5 rounded-md border border-bronze/40 bg-background p-4"><p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-bronze">Please confirm</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{proposal.summary}</p><div className="mt-4 flex gap-2"><Button disabled={busy} onClick={() => void decide('confirm')}><Check />Confirm</Button><Button variant="outline" disabled={busy} onClick={() => void decide('cancel')}><X />Cancel</Button></div></div>}
        {download && <Button variant="outline" className="mt-4" onClick={saveDownload}><Download />Download report</Button>}
        <div ref={bottom} />
      </div>
      <form className="flex shrink-0 items-end gap-2 border-t border-border p-3" onSubmit={e => { e.preventDefault(); void send(); }}>
        <textarea aria-label="Message to admin assistant" rows={2} className="min-w-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-ring disabled:opacity-50" placeholder="Type your request…" value={text} disabled={busy} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <div className="flex flex-col gap-1"><Button size="icon" title="Send request" aria-label="Send request" type="submit" disabled={busy || !text.trim()}><Send /></Button></div>
      </form>
    </section>
  </>;
}

/** Answers shown as a list, a day timeline, or figures with a small bar chart. */
function ViewCard({ view }: { view: AssistantView }) {
  if (view.type === 'list') return (
    <div className="mt-3 overflow-hidden rounded-md border border-border bg-background">
      <p className="border-b border-border px-3 py-2 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">{view.title}</p>
      <ul className="divide-y divide-border">{view.rows.map((r, i) => (
        <li key={i} className={`flex items-start gap-3 px-3 py-2.5 text-sm ${r.muted ? 'opacity-60' : ''}`}>
          <div className="min-w-0 flex-1"><p className="break-words">{r.primary}</p>{r.secondary && <p className="mt-0.5 break-words text-xs text-muted-foreground">{r.secondary}</p>}</div>
          <div className="flex shrink-0 flex-col items-end gap-1">{r.tag && <span className="rounded-full border border-bronze/40 px-2 py-0.5 text-[0.68rem] text-bronze">{r.tag}</span>}{r.meta && <span className="text-xs text-muted-foreground">{r.meta}</span>}</div>
        </li>))}</ul>
    </div>);
  if (view.type === 'timeline') return (
    <div className="mt-3 overflow-hidden rounded-md border border-border bg-background">
      <p className="border-b border-border px-3 py-2 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">{view.title}</p>
      <ol className="divide-y divide-border">{view.rows.map((r, i) => (
        <li key={i} className="flex gap-3 px-3 py-2.5 text-sm">
          <div className="w-[4.6rem] shrink-0 tabular-nums">{r.date && <p className="text-[0.68rem] text-muted-foreground">{r.date}</p>}<p className="font-medium">{r.time}</p></div>
          <div className="min-w-0 flex-1"><p className="break-words">{r.customer}</p><p className="break-words text-xs text-muted-foreground">{r.service}{r.stylist ? ` · ${r.stylist}` : ''}</p></div>
          <span className="h-fit shrink-0 rounded-full border border-border px-2 py-0.5 text-[0.68rem] text-muted-foreground">{r.status}</span>
        </li>))}</ol>
    </div>);
  const max = Math.max(1, ...(view.bars ?? []).map(b => b.value));
  return (
    <div className="mt-3 rounded-md border border-border bg-background p-3">
      <p className="text-[0.68rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">{view.title}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">{view.stats.map((s, i) => <div key={i} className="rounded border border-border px-3 py-2"><p className="text-xs text-muted-foreground">{s.label}</p><p className="font-display text-xl">{s.value}</p></div>)}</div>
      {view.bars && view.bars.length > 1 && <div className="mt-3" role="img" aria-label={`Daily: ${view.bars.map(b => `${b.label} ${b.text}`).join(', ')}`}>
        <div className="flex h-24 items-end gap-1">{view.bars.map((b, i) => <div key={i} className="flex h-full flex-1 flex-col justify-end" title={`${b.label}: ${b.text}`}><div className="rounded-t-sm bg-bronze/70" style={{ height: `${Math.max(b.value ? 6 : 2, (b.value / max) * 100)}%`, opacity: b.value ? 1 : 0.25 }} /></div>)}</div>
        <div className="mt-1 flex gap-1">{view.bars.map((b, i) => <span key={i} className="flex-1 truncate text-center text-[0.6rem] text-muted-foreground">{view.bars!.length > 10 ? (i % 3 === 0 ? b.label : '') : b.label}</span>)}</div>
      </div>}
    </div>);
}
