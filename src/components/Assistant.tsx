import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { AiCard, AssistantResponse } from '../lib/types';
import { useGeo } from '../lib/geo';
import Logo from './Logo';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  cards?: AiCard[];
  notice?: string;
}

const STARTERS = [
  'Best places near me',
  'Plan a 2-day trip to Hampi',
  'Hotels under ₹3000 in Coorg',
  'What can I see in 3 hours in Mysore?',
];

export default function Assistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const geo = useGeo();

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, open]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setBusy(true);
    try {
      const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const reply = await api<AssistantResponse>('/ai/assistant', {
        method: 'POST',
        body: { message, lat: geo.lat ?? undefined, lng: geo.lng ?? undefined, history },
      });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: reply.answer, cards: reply.cards, notice: reply.notice },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: error instanceof Error ? error.message : 'I could not reach the travel engine. Try again.',
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && (
        <div className="assistant-panel" role="dialog" aria-label="TRIPSPHERE travel assistant">
          <div className="assistant-head">
            <Logo size={28} />
            <div className="grow">
              <b>Trippy · travel concierge</b>
              <small>Grounded in TRIPSPHERE destination data</small>
            </div>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close assistant">
              ×
            </button>
          </div>

          <div className="assistant-body" ref={bodyRef}>
            {messages.length === 0 && (
              <div className="msg bot">
                Namaste. I can plan a route, find a stay or a table, estimate a budget, or fill the next few hours.
                Where are you headed?
              </div>
            )}
            {messages.map((message, index) => (
              <div key={index} style={{ display: 'contents' }}>
                <div className={`msg ${message.role === 'user' ? 'user' : 'bot'}`}>{message.content}</div>
                {message.cards && message.cards.length > 0 && (
                  <div className="assistant-cards">
                    {message.cards.map((card) => (
                      <Link key={`${card.type}-${card.slug}`} to={card.href} className="assistant-card">
                        <img src={card.image} alt="" />
                        <div style={{ minWidth: 0 }}>
                          <b>{card.name}</b>
                          <span>{card.subtitle}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
                {message.notice && <div style={{ fontSize: 9.5, color: 'var(--muted)', paddingLeft: 4 }}>{message.notice}</div>}
              </div>
            ))}
            {busy && (
              <div className="msg bot" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="spinner" /> Checking destinations…
              </div>
            )}
          </div>

          {messages.length === 0 && (
            <div className="assistant-suggestions">
              {STARTERS.map((prompt) => (
                <button key={prompt} type="button" className="chip" onClick={() => send(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          )}

          <form
            className="assistant-foot"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <input
              value={input}
              placeholder="Ask about places, stays, food or budgets…"
              aria-label="Message the travel assistant"
              onChange={(event) => setInput(event.target.value)}
            />
            <button type="submit" className="btn btn-sm" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
          <div style={{ fontSize: 9, color: 'var(--muted)', padding: '0 14px 12px', lineHeight: 1.5 }}>
            The assistant uses sample inventory. Always confirm live availability before booking.
          </div>
        </div>
      )}

      <button
        type="button"
        className="assistant-fab"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open travel assistant"
        title="Ask Trippy — travel assistant"
      >
        <span className="spark">✦</span>
        <span className="label">{open ? 'Close assistant' : 'Ask Trippy'}</span>
      </button>
    </>
  );
}
