import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { MsgThread, ChatMessage } from '../lib/api';
import { ago, fTime } from '../lib/format';
import { SearchInput, Empty, Skeleton, useToast, AlertBanner } from '../components';
import { Icon } from '../icons';

const threadName = (t: MsgThread) => t.name || 'Visiteur ' + t.session.slice(-4);
const initialOf = (t: MsgThread) => (threadName(t)[0] || 'V').toUpperCase();

export function Messages() {
  const [threads, setThreads] = useState<MsgThread[] | null>(null);
  const [ready, setReady] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [q, setQ] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const loadThreads = async () => {
    const res = await api.msgThreads();
    if (res.status === 200 && res.data) {
      setReady(res.data.ready);
      setThreads(res.data.threads || []);
    }
  };
  const loadThread = async (s: string, spin = false) => {
    if (spin) setLoadingMsgs(true);
    const res = await api.msgThread(s);
    if (res.status === 200 && res.data) setMessages(res.data.messages || []);
    setLoadingMsgs(false);
  };

  useEffect(() => {
    void loadThreads();
    const t = setInterval(() => void loadThreads(), 10000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!active) return;
    void loadThread(active, true);
    const t = setInterval(() => void loadThread(active), 6000);
    return () => clearInterval(t);
  }, [active]);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, active]);

  const filtered = useMemo(() => {
    const list = threads || [];
    const term = q.trim().toLowerCase();
    return term ? list.filter((t) => threadName(t).toLowerCase().includes(term) || t.last_body.toLowerCase().includes(term)) : list;
  }, [threads, q]);

  const send = async () => {
    const body = reply.trim();
    if (!body || !active || sending) return;
    setSending(true);
    setMessages((m) => [...m, { id: Date.now(), sender: 'admin', body, created_at: new Date().toISOString() }]);
    setReply('');
    const res = await api.msgReply(active, body);
    setSending(false);
    if (res.status === 200 && res.data?.ok) {
      void loadThread(active);
      void loadThreads();
    } else {
      toast({ title: "Échec de l'envoi", msg: 'Réessayez dans un instant.', tone: 'danger' });
    }
  };

  if (threads && !ready) {
    return (
      <div className="stagger">
        <AlertBanner level="info">
          La messagerie nécessite la table <b>messages</b> dans Supabase. Colle ce SQL dans l'éditeur SQL, puis recharge :
          <br />
          <code className="block mt-2 text-[11.5px] font-mono text-fg2">create table if not exists messages (id bigint generated always as identity primary key, session text not null, sender text not null check (sender in ('user','admin')), body text not null, name text, created_at timestamptz default now(), read_admin boolean default false, read_user boolean default false);</code>
        </AlertBanner>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="bg-panel border border-line rounded-card overflow-hidden grid grid-cols-1 md:grid-cols-[320px_1fr] h-[calc(100vh-190px)] min-h-[460px]">
        {/* Liste des conversations */}
        <aside className={`border-r border-line flex flex-col min-h-0 ${active ? 'hidden md:flex' : 'flex'}`}>
          <div className="p-3 border-b border-line">
            <SearchInput value={q} onChange={setQ} placeholder="Rechercher une conversation…" />
          </div>
          <div className="flex-1 overflow-auto no-scrollbar p-1.5">
            {threads === null ? (
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 m-1.5" />)
            ) : filtered.length ? (
              filtered.map((t) => (
                <button
                  key={t.session}
                  onClick={() => setActive(t.session)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${active === t.session ? 'bg-accent/12' : 'hover:bg-fg/[0.03]'}`}
                >
                  <span className="relative grid place-items-center h-10 w-10 rounded-full bg-panel2 text-fg2 font-semibold shrink-0">
                    {initialOf(t)}
                    {t.unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 grid place-items-center rounded-full bg-danger text-white text-[10px] font-bold border-2 border-panel">{t.unread}</span>}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[13.5px] truncate ${t.unread ? 'font-bold text-fg' : 'font-medium'}`}>{threadName(t)}</span>
                      <span className="ml-auto text-[10.5px] text-fg3 shrink-0">{ago(t.last_ts)}</span>
                    </div>
                    <div className={`text-[12px] truncate ${t.unread ? 'text-fg2' : 'text-fg3'}`}>
                      {t.last_sender === 'admin' && <span className="text-fg3">Vous : </span>}
                      {t.last_body}
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <Empty icon="bell" title="Aucune conversation">Les messages des visiteurs apparaîtront ici.</Empty>
            )}
          </div>
        </aside>

        {/* Conversation active */}
        <section className={`flex flex-col min-h-0 ${active ? 'flex' : 'hidden md:flex'}`}>
          {active ? (
            <>
              <div className="flex items-center gap-3 px-4 h-[58px] border-b border-line shrink-0">
                <button onClick={() => setActive(null)} className="md:hidden text-fg2 -ml-1"><Icon name="chevronR" className="rotate-180" size={20} /></button>
                <span className="grid place-items-center h-9 w-9 rounded-full bg-panel2 text-fg2 font-semibold">{initialOf(threads!.find((t) => t.session === active)!)}</span>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold truncate">{threadName(threads!.find((t) => t.session === active)!)}</div>
                  <div className="text-[11px] text-fg3 font-mono truncate">{active}</div>
                </div>
              </div>
              <div ref={bodyRef} className="flex-1 overflow-auto p-4 flex flex-col gap-2.5 bg-bg2">
                {loadingMsgs && !messages.length ? (
                  <div className="space-y-2.5">{[0, 1, 2].map((i) => <Skeleton key={i} className={`h-9 ${i % 2 ? 'w-2/3' : 'w-1/2 ml-auto'}`} />)}</div>
                ) : (
                  messages.map((mm) => (
                    <div key={mm.id} className={`max-w-[78%] px-3.5 py-2 rounded-2xl text-[13.5px] leading-snug whitespace-pre-wrap break-words ${mm.sender === 'admin' ? 'self-end bg-accent text-white rounded-br-md' : 'self-start bg-panel border border-line rounded-bl-md'}`}>
                      {mm.body}
                      <span className={`block text-[10px] mt-1 ${mm.sender === 'admin' ? 'text-white/70' : 'text-fg3'}`}>{fTime(mm.created_at)}</span>
                    </div>
                  ))
                )}
              </div>
              <form
                onSubmit={(e) => { e.preventDefault(); void send(); }}
                className="flex items-center gap-2.5 p-3 border-t border-line shrink-0"
              >
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Votre réponse…"
                  className="flex-1 h-11 bg-panel2 border border-line rounded-full px-4 text-[14px] text-fg placeholder:text-fg3 outline-none focus:border-line2 focus:shadow-focus transition-all"
                />
                <button type="submit" disabled={!reply.trim() || sending} className="grid place-items-center h-11 w-11 rounded-full bg-accent text-white shrink-0 hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none transition">
                  <Icon name="chevronR" size={19} />
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 grid place-items-center">
              <Empty icon="bell" title="Sélectionnez une conversation">Choisissez un visiteur à gauche pour lire et répondre.</Empty>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
