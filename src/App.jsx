import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Cloud,
  Download,
  FileText,
  FileUp,
  IndianRupee,
  Info,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Moon,
  PieChart,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  UploadCloud,
  UserPen,
  UsersRound,
  WalletCards,
  X,
  XCircle,
} from 'lucide-react';
import YearlyAnalysis from './components/YearlyAnalysis';
import {
  parseSupportedStatementPdf,
  sourceAppLabel,
  SUPPORTED_SOURCE_APPS,
} from './lib/parser';
import { hasSupabaseConfig, signInWithGoogle, supabase } from './lib/supabase';
import { productConfig } from './config';
import {
  clearLocalTransactions,
  deleteCloudAccount,
  deleteCloudTransactions,
  fetchCloudProfile,
  fetchCloudTransactions,
  mergeTransactions,
  readLocalProfile,
  readLocalTransactions,
  saveCloudProfile,
  saveCloudTransactions,
  writeLocalProfile,
  writeLocalTransactions,
} from './lib/storage';

const SOURCE_APPS = SUPPORTED_SOURCE_APPS.map((value) => ({ value, label: sourceAppLabel(value) }));
const PIE_COLORS = ['#7466e8', '#f39b64', '#4ab48a', '#62a9da', '#d673ad', '#8f86b5'];
const LOGIN_RETURN_KEY = 'trackpay:open-import-after-login';

const DEMO_TRANSACTIONS = [
  { date: '2026-10-08', time: '08:35 PM', type: 'DEBIT', amountPaise: 1000, counterparty: 'Campus Stationery', transactionId: 'DEMO-1001', description: 'Paid to Campus Stationery' },
  { date: '2026-10-08', time: '03:41 PM', type: 'DEBIT', amountPaise: 2000, counterparty: 'Evening Bakery', transactionId: 'DEMO-1002', description: 'Paid to Evening Bakery' },
  { date: '2026-10-08', time: '03:39 PM', type: 'DEBIT', amountPaise: 2000, counterparty: 'Campus Canteen', transactionId: 'DEMO-1003', description: 'Paid to Campus Canteen' },
  { date: '2026-10-07', time: '07:08 PM', type: 'DEBIT', amountPaise: 1600, counterparty: 'Campus Canteen', transactionId: 'DEMO-1004', description: 'Paid to Campus Canteen' },
  { date: '2026-10-07', time: '04:16 PM', type: 'CREDIT', amountPaise: 3000, counterparty: 'Aarav', transactionId: 'DEMO-1005', description: 'Received from Aarav' },
  { date: '2026-10-06', time: '01:24 PM', type: 'DEBIT', amountPaise: 7000, counterparty: 'Lunch Corner', transactionId: 'DEMO-1006', description: 'Paid to Lunch Corner' },
  { date: '2026-09-21', time: '08:10 PM', type: 'DEBIT', amountPaise: 5000, counterparty: 'Riya', transactionId: 'DEMO-1007', description: 'Paid to Riya' },
  { date: '2026-09-18', time: '12:45 PM', type: 'DEBIT', amountPaise: 12000, counterparty: 'Hostel Store', transactionId: 'DEMO-1008', description: 'Paid to Hostel Store' },
].map((transaction) => ({ ...transaction, sourceApp: 'demo', fingerprint: `demo-${transaction.transactionId.toLowerCase()}`, page: 1 }));

function money(paise) {
  const value = Math.abs(Number(paise || 0)) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: value % 1 ? 2 : 0,
  }).format(value);
}

function monthKey(date) { return date?.slice(0, 7); }

function formatMonth(key) {
  if (!key) return '';
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function formatDate(date) {
  if (!date) return 'Date unavailable';
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, day));
}

function formatDateLong(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(year, month - 1, day));
}

function totalOf(items, type) {
  return items.filter((item) => item.type === type).reduce((sum, item) => sum + Number(item.amountPaise || 0), 0);
}

function sortNewest(items) {
  return [...items].sort((a, b) => `${b.date || ''} ${b.time || ''}`.localeCompare(`${a.date || ''} ${a.time || ''}`));
}

function groupByCounterparty(items) {
  const groups = new Map();
  for (const item of items) {
    const key = (item.counterparty || 'Unknown counterparty').trim().toLocaleLowerCase();
    const group = groups.get(key) || {
      key, name: item.counterparty || 'Unknown counterparty', paid: 0, received: 0, count: 0, transactions: [],
    };
    if (item.type === 'DEBIT') group.paid += Number(item.amountPaise || 0);
    else group.received += Number(item.amountPaise || 0);
    group.count += 1;
    group.transactions.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Math.max(b.paid, b.received) - Math.max(a.paid, a.received));
}

function sourceLabel(sourceApp) {
  return sourceApp === 'demo' ? 'Demo' : sourceAppLabel(sourceApp || 'phonepe');
}

function Logo({ compact = false }) {
  return <div className="brand" aria-label="TrackPay"><span className="brand-mark"><WalletCards size={compact ? 17 : 19} strokeWidth={2.4} /></span>{!compact && <span>TrackPay</span>}</div>;
}

function Toast({ message, onClose }) {
  if (!message) return null;
  return <div className={`toast ${message.kind || 'info'}`} role="status">{message.kind === 'error' ? <Info size={18} /> : <CheckCircle2 size={18} />}<span>{message.text}</span><button onClick={onClose} aria-label="Close message"><X size={16} /></button></div>;
}

function AccountLoading() {
  return <main className="account-loading shell" aria-live="polite"><span><LoaderCircle className="spin" size={24} /></span><div><strong>Opening your TrackPay account</strong><p>Restoring your secure session and saved transactions…</p></div></main>;
}

function SourceBadge({ sourceApp }) {
  return <span className={`source-badge ${sourceApp || 'phonepe'}`}>{sourceLabel(sourceApp)}</span>;
}

function UploadPanel({ onFile, parsing, progress, compact = false }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const accept = (file) => { if (file) onFile(file); };
  return (
    <section className={`upload-panel ${compact ? 'compact' : ''}`}>
      {!compact && <div className="eyebrow"><Sparkles size={15} /> Private PDF import</div>}
      <h2>{compact ? 'Import a payment statement' : 'Upload a payment-app statement'}</h2>
      <p>TrackPay supports original text-based PDFs from PhonePe, GPay, Paytm, and Navi.</p>
      <div
        className={`dropzone ${dragging ? 'dragging' : ''} ${parsing ? 'disabled' : ''}`}
        onDragOver={(event) => { event.preventDefault(); if (!parsing) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); if (!parsing) accept(event.dataTransfer.files?.[0]); }}
        onClick={() => !parsing && inputRef.current?.click()}
        role="button"
        tabIndex="0"
        onKeyDown={(event) => { if (event.key === 'Enter' && !parsing) inputRef.current?.click(); }}
      >
        <span className="upload-orb">{parsing ? <LoaderCircle className="spin" size={25} /> : <UploadCloud size={25} />}</span>
        <strong>{parsing ? `Reading page ${progress.page} of ${progress.total}…` : 'Drop your PDF here'}</strong>
        <span>{parsing ? 'Your statement stays on this device.' : 'or click to choose a PDF'}</span>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={(event) => accept(event.target.files?.[0])} hidden />
      </div>
      <div className="privacy-line"><LockKeyhole size={15} /><span>The PDF is read locally and is never uploaded or stored.</span></div>
    </section>
  );
}

function GettingStarted() {
  return <aside className="how-card"><div className="section-icon lavender"><CircleHelp size={19} /></div><div><h3>What to upload</h3><p>Download a statement from a supported app, then return here.</p></div><ol className="steps"><li><span>1</span><div><b>Download the original PDF</b><small>Use PhonePe, GPay, Paytm, or Navi.</small></div></li><li><span>2</span><div><b>Choose the statement</b><small>TrackPay detects the app where possible.</small></div></li><li><span>3</span><div><b>Review before saving</b><small>Nothing saves until you confirm.</small></div></li></ol></aside>;
}

function Landing({ onFile, parsing, progress, onDemo, onLogin, cloudMode, signedIn, onBack }) {
  return <main className="landing shell"><section className="hero-copy"><button className="back-button landing-back" onClick={onBack}><ArrowLeft size={17} /> Back to welcome</button><div className="eyebrow"><Sparkles size={15} /> Money clarity for student life</div><h1>See where your<br /><em>money goes.</em></h1><p>TrackPay reads supported payment-app statements on your device, then helps you review your spending across devices.</p><div className="trust-row"><span><ShieldCheck size={17} /> PDF stays private</span><span><Cloud size={17} /> Account-scoped sync</span></div></section><div className="landing-action"><UploadPanel onFile={onFile} parsing={parsing} progress={progress} /><GettingStarted /><div className="landing-links"><button className="text-button demo-button" onClick={onDemo}><Sparkles size={16} /> Explore browser-only demo data</button>{cloudMode && !signedIn && <button className="text-button demo-button" onClick={onLogin}>Continue with Google to save your data</button>}{cloudMode && signedIn && <p className="signed-in-import-note"><CheckCircle2 size={15} /> Signed in — confirmed imports will save to your TrackPay account.</p>}</div></div></main>;
}

function SplashPage({ onBegin, onSignIn, onDemo, cloudMode }) {
  return <main className="splash-page"><section className="splash-hero shell"><div className="splash-copy"><div className="eyebrow"><Sparkles size={15} /> Private statement analysis</div><h1>Your money, <em>made clear.</em></h1><p>TrackPay turns supported payment-app statements into a simple, private view of your spending. Your PDF is read on this device — never uploaded.</p><div className="splash-actions"><button className="primary-button" onClick={onBegin}><ArrowRight size={18} /> Get started</button><button className="secondary-button" onClick={onSignIn}>Sign in</button></div><div className="splash-proof"><span><ShieldCheck size={16} /> PDF stays private</span><span><CheckCircle2 size={16} /> Review before saving</span></div></div><div className="splash-preview" aria-label="Illustration of TrackPay analysis"><div className="preview-glow" /><div className="preview-card preview-card-top"><span className="preview-icon"><WalletCards size={18} /></span><div><small>THIS MONTH</small><strong>Spending clarity</strong></div><span className="preview-check"><CheckCircle2 size={17} /></span></div><div className="preview-card preview-chart"><div className="mini-pie"><i /><i /><i /></div><div><small>OUTGOING PAYMENTS</small><strong>See where money went</strong><span>Exact names · debit only</span></div></div><div className="preview-card preview-apps"><span>Works with</span>{SOURCE_APPS.map((app) => <SourceBadge sourceApp={app.value} key={app.value} />)}</div></div></section><section className="splash-trust shell"><article><span><LockKeyhole size={20} /></span><div><h2>Private by design</h2><p>Statements are parsed in your browser. The original file is never stored.</p></div></article><article><span><FileText size={20} /></span><div><h2>Made for real statements</h2><p>Use original text-based PDFs from four supported payment apps.</p></div></article><article><span><Sparkles size={20} /></span><div><h2>Try it safely</h2><p>Explore fictional browser-only data before importing anything personal.</p><button className="text-button" onClick={onDemo}>Open demo <ArrowRight size={15} /></button></div></article></section>{!cloudMode && <p className="splash-local-note shell"><Landmark size={15} /> Local preview mode: Google sign-in becomes available when Supabase is configured. You can still inspect the final interface and browser-only demo now.</p>}</main>;
}

function SignInPage({ cloudMode, onLogin, onContinueLocal, onDemo, onBack }) {
  return <main className="signin-page shell"><section className="signin-visual"><button className="back-button" onClick={onBack}><ArrowLeft size={17} /> Back</button><div className="eyebrow"><ShieldCheck size={15} /> Private by design</div><h1>Your statements stay <em>yours.</em></h1><p>TrackPay reads files locally. After you review an import, only confirmed extracted rows can sync to your account.</p><div className="signin-points"><span><CheckCircle2 size={17} /> No PDF upload or storage</span><span><CheckCircle2 size={17} /> Account-scoped transaction data</span><span><CheckCircle2 size={17} /> Delete data or your TrackPay account anytime</span></div></section><section className="signin-card"><Logo /><div className="signin-card-copy"><h2>Welcome to TrackPay</h2><p>{cloudMode ? 'Sign in to keep your confirmed transactions available across your devices.' : 'This local preview is ready to explore. Cloud sign-in can be enabled later without changing the PDF privacy model.'}</p></div>{cloudMode ? <><button className="google-button" onClick={onLogin}><span className="google-g">G</span> Continue with Google</button><small className="signin-helper"><LockKeyhole size={14} /> TrackPay never sees your Google password.</small></> : <><div className="local-auth-message"><Landmark size={18} /><div><strong>Local preview mode</strong><span>Google authentication is not configured in this local copy.</span></div></div><button className="primary-button full-button" onClick={onContinueLocal}><ArrowRight size={17} /> Continue in this browser</button><small className="signin-helper"><LockKeyhole size={14} /> Any local imports stay in this browser until cloud sync is configured.</small></>}<div className="signin-divider"><span>or</span></div><button className="secondary-button demo-signin-button" onClick={onDemo}><Sparkles size={17} /> Explore fictional demo data</button><p className="signin-terms">By continuing, you agree to the <a href="?page=terms">Terms</a> and acknowledge the <a href="?page=privacy">Privacy Policy</a>.</p></section></main>;
}

function SummaryCard({ label, value, icon, tone, helper }) {
  return <div className={`summary-card ${tone}`}><div className="summary-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong>{helper && <small>{helper}</small>}</div></div>;
}

function TransactionType({ type }) {
  return <span className={`type-pill ${type === 'CREDIT' ? 'credit' : 'debit'}`}>{type === 'CREDIT' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}{type === 'CREDIT' ? 'Credit' : 'Debit'}</span>;
}

function SpendingPie({ transactions, title = 'Where money went' }) {
  const groups = groupByCounterparty(transactions.filter((item) => item.type === 'DEBIT'))
    .filter((group) => group.paid > 0)
    .sort((a, b) => b.paid - a.paid);
  const total = groups.reduce((sum, group) => sum + group.paid, 0);
  if (!total) return <section className="spending-pie empty"><div><PieChart size={22} /></div><p>No outgoing payments are available for this period.</p></section>;
  const top = groups.slice(0, 5);
  const remainder = groups.slice(5).reduce((sum, group) => sum + group.paid, 0);
  const items = remainder ? [...top, { name: 'Other', paid: remainder }] : top;
  let cursor = 0;
  const gradient = items.map((item, index) => {
    const start = cursor;
    cursor += (item.paid / total) * 100;
    return `${PIE_COLORS[index % PIE_COLORS.length]} ${start}% ${cursor}%`;
  }).join(', ');
  return <section className="spending-pie"><header><div><h2>{title}</h2><p>Outgoing debits only · top five exact names</p></div><strong>{money(total)}</strong></header><div className="pie-content"><div className="pie-visual" style={{ background: `conic-gradient(${gradient})` }}><span><b>{items.length}</b><small>groups</small></span></div><ul>{items.map((item, index) => <li key={item.name}><i style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} /><span title={item.name}>{item.name}</span><b>{money(item.paid)}</b></li>)}</ul></div></section>;
}

function MonthCard({ month, items, onClick }) {
  const debit = totalOf(items, 'DEBIT'); const credit = totalOf(items, 'CREDIT');
  return <button className="month-card" onClick={onClick}><div className="month-card-top"><span className="calendar-mini"><CalendarDays size={16} /></span><span>{formatMonth(month)}</span><ArrowRight size={17} /></div><div className="month-total"><span>Paid</span><strong>{money(debit)}</strong></div><div className="month-meta"><span>{items.length} {items.length === 1 ? 'transaction' : 'transactions'}</span>{credit > 0 && <span className="received-mini">+ {money(credit)} received</span>}</div></button>;
}

function DayCard({ day, items, onClick }) {
  const debit = totalOf(items, 'DEBIT'); const credit = totalOf(items, 'CREDIT');
  return <button className="day-card" onClick={onClick}><div className="day-card-date"><span>{formatDate(day)}</span><small>{items.length} entries</small></div><div className="day-card-amount"><strong>{money(debit)}</strong><small>{credit ? `+${money(credit)} in` : 'paid'}</small></div><ArrowRight size={17} /></button>;
}

function TransactionTable({ transactions, onOpen, showDate = false, showSource = false }) {
  return <section className="transaction-table"><div className="transaction-table-head"><span>Transaction details</span><span>Type</span><span>Amount</span><span /></div>{transactions.map((transaction) => <button className="transaction-row" key={transaction.fingerprint} onClick={() => onOpen(transaction)}><div className="transaction-main"><span className={`transaction-icon ${transaction.type === 'CREDIT' ? 'in' : ''}`}>{transaction.type === 'CREDIT' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</span><div><strong>{transaction.description || `${transaction.type === 'CREDIT' ? 'Received from' : 'Paid to'} ${transaction.counterparty}`}</strong><small>{showDate ? `${formatDate(transaction.date)} · ` : ''}{transaction.time || 'Time unavailable'}{showSource ? <> · <SourceBadge sourceApp={transaction.sourceApp} /></> : ''}</small></div></div><TransactionType type={transaction.type} /><strong className={transaction.type === 'CREDIT' ? 'amount-credit' : ''}>{transaction.type === 'CREDIT' ? '+' : '−'}{money(transaction.amountPaise)}</strong><ArrowRight className="row-open" size={17} /></button>)}</section>;
}

function AllTransactions({ transactions, onOpen }) {
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('all');
  const [source, setSource] = useState('all');
  const availableSources = [...new Set(transactions.map((item) => item.sourceApp || 'phonepe'))].sort();
  const filtered = useMemo(() => sortNewest(transactions.filter((item) => {
    const search = `${item.counterparty || ''} ${item.description || ''} ${item.transactionId || ''} ${item.utr || ''}`.toLocaleLowerCase();
    return (!query || search.includes(query.toLocaleLowerCase()))
      && (!from || item.date >= from)
      && (!to || item.date <= to)
      && (type === 'all' || item.type === type)
      && (source === 'all' || (item.sourceApp || 'phonepe') === source);
  })), [transactions, query, from, to, type, source]);
  const clear = () => { setQuery(''); setFrom(''); setTo(''); setType('all'); setSource('all'); };
  return <section className="all-transactions"><div className="section-heading"><div><h2>All transactions</h2><p>Newest first. Search names, descriptions, or reference identifiers.</p></div><strong className="result-count">{filtered.length.toLocaleString('en-IN')} shown</strong></div><div className="filters"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search transactions" /></label><label><span>From</span><input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label><label><span>To</span><input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label><label><span>Type</span><select value={type} onChange={(event) => setType(event.target.value)}><option value="all">All types</option><option value="DEBIT">Debit</option><option value="CREDIT">Credit</option></select></label><label><span>Source app</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All apps</option>{availableSources.map((app) => <option key={app} value={app}>{sourceLabel(app)}</option>)}</select></label><button className="filter-reset" onClick={clear}><SlidersHorizontal size={15} /> Reset</button></div>{filtered.length ? <TransactionTable transactions={filtered} onOpen={onOpen} showDate showSource /> : <div className="filter-empty"><Search size={21} /><p>No transactions match those filters.</p><button className="text-button" onClick={clear}>Clear filters</button></div>}</section>;
}

function Dashboard({ transactions, activeTab, onTab, monthPage, setMonthPage, onMonth, onDay, onOpenTransaction, onUpload, displayName, demoMode, onExitDemo }) {
  const monthItems = useMemo(() => {
    const map = new Map();
    for (const transaction of transactions) { const key = monthKey(transaction.date); if (!map.has(key)) map.set(key, []); map.get(key).push(transaction); }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [transactions]);
  const visibleMonths = monthItems.slice(monthPage * 12, (monthPage + 1) * 12);
  const visibleSet = new Set(visibleMonths.map(([key]) => key));
  const dayItems = useMemo(() => {
    const map = new Map();
    for (const transaction of transactions) { if (visibleSet.has(monthKey(transaction.date))) { if (!map.has(transaction.date)) map.set(transaction.date, []); map.get(transaction.date).push(transaction); } }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [transactions, visibleMonths]);
  const paid = totalOf(transactions, 'DEBIT'); const received = totalOf(transactions, 'CREDIT');
  const canShowOlder = (monthPage + 1) * 12 < monthItems.length;
  return <main className="dashboard shell"><section className="dashboard-heading"><div><div className="eyebrow">{demoMode ? <><Sparkles size={15} /> Browser-only demo</> : <><Sparkles size={15} /> Your private overview</>}</div><h1>{demoMode ? 'Try TrackPay safely.' : `Good to see you${displayName ? `, ${displayName.split(' ')[0]}` : ''}.`}</h1><p>{demoMode ? 'These fictional entries are not saved or mixed with your account.' : 'Every payment, organised without the spreadsheet.'}</p></div>{demoMode ? <button className="secondary-button" onClick={onExitDemo}><X size={17} /> Exit demo</button> : <button className="primary-button" onClick={onUpload}><Plus size={18} /> Upload statement</button>}</section>{demoMode && <div className="demo-banner"><Sparkles size={17} /><span><b>Demo mode:</b> fictional data lives only in this browser session. It never reaches Supabase.</span></div>}<section className="summary-grid"><SummaryCard label="Total paid" value={money(paid)} helper="Across imported statements" icon={<ArrowUpRight size={20} />} tone="purple" /><SummaryCard label="Money received" value={money(received)} helper="Normal received-money entries" icon={<ArrowDownLeft size={20} />} tone="green" /><SummaryCard label="Transactions" value={transactions.length.toLocaleString('en-IN')} helper="Duplicates are skipped" icon={<ReceiptText size={20} />} tone="orange" /></section><section className="data-section"><div className="section-heading dashboard-tabs"><div><h2>{activeTab === 'all' ? 'Your activity' : activeTab === 'daily' ? 'Daily activity' : 'Your statements'}</h2><p>{activeTab === 'all' ? 'Search and filter every imported transaction.' : activeTab === 'daily' ? 'Only days with imported transactions appear below.' : 'Only months found in imported statements appear below.'}</p></div><div className="segmented four-options" aria-label="TrackPay analysis views"><button className={activeTab === 'all' ? 'active' : ''} onClick={() => onTab('all')}><ReceiptText size={15} /> All</button><button className={activeTab === 'monthly' ? 'active' : ''} onClick={() => onTab('monthly')}><CalendarDays size={15} /> Monthly</button><button className={activeTab === 'daily' ? 'active' : ''} onClick={() => onTab('daily')}><CalendarDays size={15} /> Daily</button><button onClick={() => onTab('years')}><PieChart size={15} /> Years</button></div></div>{activeTab === 'all' && <AllTransactions transactions={transactions} onOpen={onOpenTransaction} />}{activeTab !== 'all' && <>{monthItems.length > 12 && <div className="twelve-note"><Info size={15} /> Showing 12 months at a time. Use the arrows to move through your history.</div>}<div className={activeTab === 'monthly' ? 'months-grid' : 'days-list'}>{activeTab === 'monthly' ? visibleMonths.map(([month, items]) => <MonthCard key={month} month={month} items={items} onClick={() => onMonth(month)} />) : dayItems.map(([day, items]) => <DayCard key={day} day={day} items={items} onClick={() => onDay(day)} />)}</div>{monthItems.length > 12 && <div className="pagination"><button disabled={monthPage === 0} onClick={() => setMonthPage(Math.max(0, monthPage - 1))}><ArrowLeft size={16} /> Newer</button><span>{monthPage * 12 + 1}–{Math.min((monthPage + 1) * 12, monthItems.length)} of {monthItems.length} months</span><button disabled={!canShowOlder} onClick={() => setMonthPage(monthPage + 1)}>Older <ArrowRight size={16} /></button></div>}</>}</section></main>;
}

function BackButton({ onClick, children = 'Back to overview' }) { return <button className="back-button" onClick={onClick}><ArrowLeft size={17} />{children}</button>; }

function MonthlyDetail({ month, transactions, onBack, onTransaction }) {
  const groups = groupByCounterparty(transactions); const paid = totalOf(transactions, 'DEBIT'); const received = totalOf(transactions, 'CREDIT');
  return <main className="detail-page shell"><BackButton onClick={onBack} /><header className="detail-heading"><div><div className="eyebrow"><CalendarDays size={15} /> Monthly breakdown</div><h1>{formatMonth(month)}</h1><p>Exact payment names are grouped; similar names are never merged.</p></div><div className="detail-total"><span>Total paid</span><strong>{money(paid)}</strong>{received > 0 && <small>{money(received)} received</small>}</div></header><SpendingPie transactions={transactions} /><section className="group-list"><div className="group-list-head"><span>Person or shop</span><span>Activity</span><span>Paid</span><span /></div>{groups.map((group) => <article className="group-row" key={group.key}><div className="counterparty"><span className="avatar">{group.name.charAt(0).toUpperCase()}</span><div><strong>{group.name}</strong><small>{group.count} {group.count === 1 ? 'transaction' : 'transactions'}</small></div></div><div className="group-flow">{group.paid > 0 && <span className="outflow"><ArrowUpRight size={14} /> {money(group.paid)}</span>}{group.received > 0 && <span className="inflow"><ArrowDownLeft size={14} /> {money(group.received)}</span>}</div><strong className="group-paid">{group.paid ? money(group.paid) : '—'}</strong><button className="row-arrow" aria-label={`View ${group.name} transactions`} onClick={() => onTransaction(group.transactions)}><ChevronDown size={17} /></button></article>)}</section><p className="detail-footnote"><ShieldCheck size={16} /> This spending chart counts outgoing debit payments only.</p></main>;
}

function DailyDetail({ day, transactions, onBack, onOpenTransaction }) {
  const paid = totalOf(transactions, 'DEBIT'); const received = totalOf(transactions, 'CREDIT');
  return <main className="detail-page shell"><BackButton onClick={onBack} /><header className="detail-heading"><div><div className="eyebrow"><ReceiptText size={15} /> Daily transactions</div><h1>{formatDateLong(day)}</h1><p>{transactions.length} {transactions.length === 1 ? 'entry' : 'entries'} from your statements.</p></div><div className="detail-total"><span>Paid today</span><strong>{money(paid)}</strong>{received > 0 && <small>{money(received)} received</small>}</div></header><TransactionTable transactions={sortNewest(transactions)} onOpen={onOpenTransaction} showSource /></main>;
}

function TransactionDrawer({ transaction, onClose }) {
  if (!transaction) return null;
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="transaction-drawer" onMouseDown={(event) => event.stopPropagation()}><button className="icon-button drawer-close" onClick={onClose} aria-label="Close"><X size={19} /></button><span className={`drawer-icon ${transaction.type === 'CREDIT' ? 'in' : ''}`}>{transaction.type === 'CREDIT' ? <ArrowDownLeft size={22} /> : <ArrowUpRight size={22} />}</span><TransactionType type={transaction.type} /><h2>{transaction.counterparty}</h2><strong className={transaction.type === 'CREDIT' ? 'amount-credit big-amount' : 'big-amount'}>{transaction.type === 'CREDIT' ? '+' : '−'}{money(transaction.amountPaise)}</strong><dl className="transaction-meta"><div><dt>Date</dt><dd>{formatDate(transaction.date)}</dd></div><div><dt>Time</dt><dd>{transaction.time || 'Not in statement'}</dd></div><div><dt>Source app</dt><dd><SourceBadge sourceApp={transaction.sourceApp} /></dd></div>{transaction.transactionId && <div><dt>Transaction ID</dt><dd>{transaction.transactionId}</dd></div>}{transaction.utr && <div><dt>UTR number</dt><dd>{transaction.utr}</dd></div>}</dl></section></div>;
}

function GroupTransactionsDrawer({ transactions, onClose, onOpen }) {
  if (!transactions) return null;
  const group = transactions[0];
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="transaction-drawer group-drawer" onMouseDown={(event) => event.stopPropagation()}><button className="icon-button drawer-close" onClick={onClose} aria-label="Close"><X size={19} /></button><div className="eyebrow"><UsersRound size={15} /> All matching entries</div><h2>{group?.counterparty}</h2><p>{transactions.length} transactions appear with this exact name.</p><div className="small-transactions">{sortNewest(transactions).map((transaction) => <button key={transaction.fingerprint} onClick={() => onOpen(transaction)}><span><b>{formatDate(transaction.date)}</b><small>{transaction.time || 'Time unavailable'} · {sourceLabel(transaction.sourceApp)}</small></span><strong className={transaction.type === 'CREDIT' ? 'amount-credit' : ''}>{transaction.type === 'CREDIT' ? '+' : '−'}{money(transaction.amountPaise)}</strong></button>)}</div></section></div>;
}

function SourcePicker({ detection, onSelect, onClose }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="choice-modal" onMouseDown={(event) => event.stopPropagation()}><button className="icon-button drawer-close" onClick={onClose} aria-label="Close"><X size={19} /></button><span className="choice-icon"><FileText size={24} /></span><div className="eyebrow"><Info size={15} /> Choose statement source</div><h2>Which app made this statement?</h2><p>TrackPay could not identify it with enough certainty. Selecting the app only chooses a local parser; the PDF is never uploaded.</p>{detection?.app && <p className="detection-hint">Possible match: <b>{sourceAppLabel(detection.app)}</b></p>}<div className="source-choices">{SOURCE_APPS.map((app) => <button key={app.value} onClick={() => onSelect(app.value)}>{app.label}<ArrowRight size={16} /></button>)}</div></section></div>;
}

function ImportReview({ review, onConfirm, onClose, saving }) {
  const { result, newTransactions, duplicateCount } = review;
  const { summary } = result;
  const declared = summary.declared;
  const hasDeclaredTotals = declared.paidPaise !== null || declared.receivedPaise !== null;
  return <div className="modal-backdrop" onMouseDown={() => !saving && onClose()}><section className="review-modal" onMouseDown={(event) => event.stopPropagation()}><button className="icon-button drawer-close" onClick={() => !saving && onClose()} aria-label="Close"><X size={19} /></button><div className="review-heading"><span className="choice-icon"><CheckCircle2 size={24} /></span><div><div className="eyebrow"><ShieldCheck size={15} /> Review before saving</div><h2>Check this import</h2><p><SourceBadge sourceApp={result.sourceApp} /> {result.detection.confident ? 'Detected locally from the statement format.' : 'Selected manually after local detection was uncertain.'}</p></div></div><div className="review-stats"><article><small>Rows found</small><strong>{summary.rowsFound}</strong></article><article><small>New rows</small><strong>{newTransactions.length}</strong></article><article><small>Duplicates</small><strong>{duplicateCount}</strong></article><article><small>Skipped special rows</small><strong>{summary.skippedRows}</strong></article><article><small>Unreadable rows</small><strong>{summary.unreadableRows}</strong></article></div>{hasDeclaredTotals && <section className={`reconciliation ${summary.totalsComparable && summary.totalsMatch ? 'match' : 'review'}`}><div>{summary.totalsComparable && summary.totalsMatch ? <CheckCircle2 size={19} /> : <Info size={19} />}</div><div><strong>{summary.totalsComparable && summary.totalsMatch ? 'Statement totals match' : 'Statement totals need review'}</strong><p>Statement: paid {declared.paidPaise !== null ? money(declared.paidPaise) : '—'} · received {declared.receivedPaise !== null ? money(declared.receivedPaise) : '—'}<br />Parsed: paid {money(summary.parsed.paidPaise)} · received {money(summary.parsed.receivedPaise)}</p>{!summary.totalsComparable && <small>Special or unreadable rows mean a direct comparison is not available.</small>}</div></section>}{result.issues.length > 0 && <div className="review-warning"><Info size={17} /><span>{result.issues.join(' ')}</span></div>}<section className="review-preview"><div><h3>Preview of new transactions</h3><span>{newTransactions.length ? `Showing first ${Math.min(newTransactions.length, 8)}` : 'No new rows to save'}</span></div>{newTransactions.length ? <div className="review-table">{newTransactions.slice(0, 8).map((item) => <div key={item.fingerprint}><span><b>{formatDate(item.date)}</b><small>{item.counterparty}</small></span><TransactionType type={item.type} /><strong className={item.type === 'CREDIT' ? 'amount-credit' : ''}>{item.type === 'CREDIT' ? '+' : '−'}{money(item.amountPaise)}</strong></div>)}</div> : <p className="no-new-copy">Every readable normal transaction already exists in this account.</p>}</section><div className="review-actions"><button className="secondary-button" disabled={saving} onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving || !newTransactions.length} onClick={onConfirm}>{saving ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}{saving ? 'Saving…' : newTransactions.length ? `Save ${newTransactions.length} new row${newTransactions.length === 1 ? '' : 's'}` : 'Nothing new to save'}</button></div><p className="review-privacy"><LockKeyhole size={14} /> The original PDF will be discarded after this review. Only confirmed extracted rows are saved.</p></section></div>;
}

function DisplayNameModal({ initialName, onSave, onClose, saving }) {
  const [name, setName] = useState(initialName || '');
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="choice-modal small" onMouseDown={(event) => event.stopPropagation()}><button className="icon-button drawer-close" onClick={onClose} aria-label="Close"><X size={19} /></button><span className="choice-icon"><UserPen size={24} /></span><div className="eyebrow"><UserPen size={15} /> TrackPay profile</div><h2>Edit display name</h2><p>This changes your TrackPay-only display name. It never changes your Google account name.</p><label className="name-input"><span>Display name</span><input autoFocus maxLength="60" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Priya" /></label><div className="review-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving} onClick={() => onSave(name)}>{saving ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}Save name</button></div></section></div>;
}

function DeleteAccountModal({ onDelete, onClose, deleting }) {
  const [confirmation, setConfirmation] = useState('');
  return <div className="modal-backdrop" onMouseDown={() => !deleting && onClose()}><section className="choice-modal danger-modal" onMouseDown={(event) => event.stopPropagation()}><button className="icon-button drawer-close" onClick={() => !deleting && onClose()} aria-label="Close"><X size={19} /></button><span className="choice-icon danger"><Trash2 size={24} /></span><div className="eyebrow"><Info size={15} /> Permanent action</div><h2>Delete TrackPay account?</h2><p>This permanently deletes your TrackPay profile, saved transactions, and Supabase sign-in identity. It does not delete your Google account.</p><label className="name-input"><span>Type <b>DELETE</b> to continue</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button className="danger-button full-button" disabled={confirmation !== 'DELETE' || deleting} onClick={onDelete}>{deleting ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}{deleting ? 'Deleting account…' : 'Permanently delete account'}</button></section></div>;
}

function LogoutModal({ onLogout, onClose, signingOut }) {
  return <div className="modal-backdrop" onMouseDown={() => !signingOut && onClose()}><section className="choice-modal logout-modal" onMouseDown={(event) => event.stopPropagation()}><button className="icon-button drawer-close" onClick={() => !signingOut && onClose()} aria-label="Close"><X size={19} /></button><span className="choice-icon"><LogOut size={24} /></span><div className="eyebrow"><LockKeyhole size={15} /> End this browser session</div><h2>Sign out of TrackPay?</h2><p>You will need to sign in again to view this account. Your confirmed transactions and TrackPay display name will remain safely stored in your account.</p><div className="review-actions"><button className="secondary-button" disabled={signingOut} onClick={onClose}>Cancel</button><button className="primary-button" disabled={signingOut} onClick={onLogout}>{signingOut ? <LoaderCircle className="spin" size={17} /> : <LogOut size={17} />}{signingOut ? 'Signing out…' : 'Sign out'}</button></div></section></div>;
}

function SupportEmail() { return productConfig.supportEmailIsPlaceholder ? <span className="placeholder-email" title="Replace this address before public launch">{productConfig.supportEmail}</span> : <a className="support-email" href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a>; }

function LegalPage({ page, session, onDeleteData, deletingData, onAccountDelete }) {
  const titles = { privacy: ['Privacy Policy', 'Clear information about how TrackPay handles statement data.'], terms: ['Terms of Use', 'The rules for using TrackPay responsibly.'], help: ['Help & Contact', 'Answers about imports, accounts, and your data.'] };
  const [title, subtitle] = titles[page] || titles.privacy;
  return <main className="legal-page shell"><a className="back-button" href="/"><ArrowLeft size={17} />Back to TrackPay</a><header className="legal-heading"><div className="eyebrow"><ShieldCheck size={15} /> TrackPay information centre</div><h1>{title}</h1><p>{subtitle}</p><small>Last updated: {productConfig.policyLastUpdated}</small></header>{page === 'privacy' && <div className="legal-content"><section><h2>1. Your statement PDF stays on your device</h2><p>TrackPay reads supported original, text-based PDFs from PhonePe, GPay, Paytm, and Navi in your browser. The original PDF is never uploaded to Supabase, hosting, or another storage service.</p></section><section><h2>2. Data saved after confirmation</h2><p>After you review and confirm an import, TrackPay may save extracted normal transaction data: source app, date, time, debit or credit type, amount, counterparty, transaction identifier, and description. TrackPay does not save the original PDF or its file name.</p></section><section><h2>3. Account isolation</h2><p>Signed-in data is stored in Supabase with account-scoped Row Level Security. We use Google Sign-In only to identify your TrackPay account. TrackPay does not access Gmail, Drive, contacts, calendar, or live payment-app data.</p></section><section><h2>4. Your choices</h2><p>You can clear all saved transaction records or permanently delete your TrackPay account. Account deletion removes the TrackPay sign-in identity and saved TrackPay data; it does not delete your Google account.</p></section><section><h2>5. Limits</h2><p>TrackPay cannot make payments, link to a live payment app, or track transactions in real time. It supports recognised statement layouts and asks for review before saving.</p></section></div>}{page === 'terms' && <div className="legal-content"><section><h2>1. Use your own statements</h2><p>Use TrackPay only with payment-app statements you are authorised to access. Do not import someone else’s data without clear permission.</p></section><section><h2>2. Accuracy and review</h2><p>Layouts can change. TrackPay reads recognised PDF formats, shows an import review, and does not merge similar-looking names. Review your data before relying on it.</p></section><section><h2>3. What TrackPay includes</h2><p>TrackPay organises normal completed payments and normal received-money transactions. It intentionally skips refunds, reversals, cashbacks, self transfers, failed payments, and pending payments.</p></section><section><h2>4. No financial advice</h2><p>TrackPay is a personal organisation tool, not a bank, payment service, or source of tax, legal, or financial advice.</p></section></div>}{page === 'help' && <div className="legal-content help-content"><section><h2>How do I import a statement?</h2><ol><li>Download an original text-based PDF in PhonePe, GPay, Paytm, or Navi.</li><li>Sign in with Google if cloud sync is enabled.</li><li>Upload it to TrackPay; detection and parsing happen in your browser.</li><li>Check the source app, counts, and preview, then confirm saving.</li></ol><p>Scanned PDFs and screenshots cannot be read reliably. Navi statements are imported for outgoing payments only because its user export does not provide received-money entries.</p></section><section><h2>Does TrackPay upload my PDF?</h2><p>No. TrackPay parses the PDF locally. The original file is discarded when you close or finish the review.</p></section><section className="data-control"><h2>Manage saved data</h2>{session ? <><p>Clear-data removes saved transaction rows but keeps your TrackPay account. Account deletion permanently removes both the saved data and TrackPay account identity.</p><div className="legal-actions"><button className="danger-button" disabled={deletingData} onClick={onDeleteData}>{deletingData ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}{deletingData ? 'Deleting saved data…' : 'Clear saved transaction data'}</button><button className="text-button delete-link" onClick={onAccountDelete}>Delete TrackPay account</button></div></> : <p className="signin-note"><LockKeyhole size={15} /> Sign in to manage cloud-saved data.</p>}</section><section><h2>Contact</h2><p>Need help? Contact <SupportEmail />.</p></section></div>}</main>;
}

function Footer() { return <footer><Logo /><span>Private by design. Built for student spending clarity.</span><nav className="footer-links"><a href="?page=privacy">Privacy</a><a href="?page=terms">Terms</a><a href="?page=help">Help & Contact</a></nav><span>© {new Date().getFullYear()} TrackPay</span></footer>; }

function Header({ session, displayName, onLogin, onLogout, cloudMode, theme, onTheme, onEditName, onClearData, onDeleteAccount, demoMode, onExitDemo }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const googleName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || 'Account';
  const name = displayName || (session ? googleName : 'Local profile');
  const profileMenu = (local = false) => <div className="profile-menu"><div><small>{local ? 'Local browser profile' : 'Signed in as'}</small><strong>{local ? 'Cloud sync is not configured' : session.user.email}</strong></div><button onClick={() => { setMenuOpen(false); onEditName(); }}><UserPen size={16} /> Edit TrackPay name</button><button onClick={() => { setMenuOpen(false); onTheme(); }}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}{theme === 'dark' ? 'Use light mode' : 'Use dark mode'}</button><button onClick={() => { setMenuOpen(false); onClearData(); }}><Trash2 size={16} /> Clear saved data</button>{!local && <><button className="profile-danger" onClick={() => { setMenuOpen(false); onDeleteAccount(); }}><XCircle size={16} /> Delete account</button><button onClick={() => { setMenuOpen(false); onLogout(); }}><LogOut size={16} /> Sign out</button></>}</div>;
  return <header className="site-header"><div className="header-inner"><a href="/" aria-label="TrackPay home"><Logo /></a><nav><a href="?page=privacy">Privacy</a><a href="?page=help">How it works</a></nav><div className="header-actions">{demoMode && <button className="demo-chip" onClick={onExitDemo}><Sparkles size={14} /> Demo · exit</button>}<button className="theme-button" onClick={onTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>{session ? <div className="profile-wrap"><button className="user-chip" onClick={() => setMenuOpen(!menuOpen)}>{session.user.user_metadata?.avatar_url ? <img src={session.user.user_metadata.avatar_url} alt="" /> : <span>{name.charAt(0).toUpperCase()}</span>}{name}<ChevronDown size={14} /></button>{menuOpen && profileMenu()}</div> : cloudMode ? <button className="login-button" onClick={onLogin}>Continue with Google</button> : <div className="profile-wrap"><button className="local-chip user-chip" onClick={() => setMenuOpen(!menuOpen)}><span>{name.charAt(0).toUpperCase()}</span>{name}<ChevronDown size={14} /></button>{menuOpen && profileMenu(true)}</div>}<a className="mobile-menu" href="?page=help" aria-label="Open help"><Menu size={19} /></a></div></div></header>;
}

function App() {
  const [session, setSession] = useState(null);
  const [transactions, setTransactions] = useState(() => hasSupabaseConfig ? [] : readLocalTransactions());
  const [displayName, setDisplayName] = useState(() => readLocalProfile().displayName || '');
  const [theme, setTheme] = useState(() => localStorage.getItem('trackpay:theme') || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [accountReady, setAccountReady] = useState(() => !hasSupabaseConfig);
  const [entryScreen, setEntryScreen] = useState(() => sessionStorage.getItem(LOGIN_RETURN_KEY) === 'import' ? 'import' : 'splash');
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState({ page: 0, total: 0 });
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [view, setView] = useState('dashboard');
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [monthPage, setMonthPage] = useState(0);
  const [showUpload, setShowUpload] = useState(false);
  const [sourcePicker, setSourcePicker] = useState(null);
  const [importReview, setImportReview] = useState(null);
  const [savingImport, setSavingImport] = useState(false);
  const [transactionDrawer, setTransactionDrawer] = useState(null);
  const [groupDrawer, setGroupDrawer] = useState(null);
  const [deletingData, setDeletingData] = useState(false);
  const [showNameEditor, setShowNameEditor] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [showAccountDelete, setShowAccountDelete] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  const notify = (text, kind = 'success') => { setToast({ text, kind }); window.setTimeout(() => setToast(null), 5000); };
  const dataTransactions = demoMode ? DEMO_TRANSACTIONS : transactions;

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('trackpay:theme', theme); }, [theme]);

  useEffect(() => {
    if (!supabase) return undefined;
    let alive = true;
    const loadAccount = async (activeSession) => {
      if (!activeSession) {
        if (alive) setAccountReady(true);
        return;
      }
      if (alive) setAccountReady(false);
      try {
        // A missing optional profile row must not stop transaction history from
        // loading. This keeps old Spendwise history visible during migration.
        const cloudTransactions = await fetchCloudTransactions();
        if (alive) setTransactions(cloudTransactions);
        try {
          const profile = await fetchCloudProfile();
          if (alive) setDisplayName(profile?.displayName || '');
        } catch (profileError) {
          if (alive) notify(`Could not load TrackPay profile: ${profileError.message}`, 'error');
        }
      } catch (error) {
        if (alive) notify(`Could not load TrackPay cloud data: ${error.message}`, 'error');
      } finally {
        if (alive) setAccountReady(true);
      }
    };
    const applySession = (activeSession) => {
      if (!alive) return;
      setSession(activeSession);
      if (!activeSession) {
        setTransactions([]);
        setDisplayName('');
        setView('dashboard');
        setEntryScreen('splash');
        setAccountReady(true);
        return;
      }
      if (sessionStorage.getItem(LOGIN_RETURN_KEY) === 'import') {
        setEntryScreen('import');
        sessionStorage.removeItem(LOGIN_RETURN_KEY);
      }
      loadAccount(activeSession);
    };
    supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // Defer work outside the auth callback to avoid Supabase deadlocks.
      window.setTimeout(() => applySession(newSession), 0);
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  const onLogin = async () => {
    try {
      // Survives the OAuth full-page redirect once, but is removed as soon as
      // the restored session is loaded. Later browser refreshes open dashboard.
      sessionStorage.setItem(LOGIN_RETURN_KEY, 'import');
      await signInWithGoogle();
    } catch (error) {
      sessionStorage.removeItem(LOGIN_RETURN_KEY);
      notify(error.message, 'error');
    }
  };
  const onLogout = async () => {
    if (!supabase) return;
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setShowLogoutConfirm(false);
      notify('Signed out. Your TrackPay data remains securely stored.');
    } catch (error) {
      notify(`Could not sign out: ${error.message}`, 'error');
    } finally {
      setSigningOut(false);
    }
  };
  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');

  const submitForReview = async (file, forcedSourceApp) => {
    if (!file || parsing) return;
    if (demoMode) { notify('Exit demo mode before importing a personal statement.', 'error'); return; }
    if (hasSupabaseConfig && !session) { notify('Continue with Google before importing so your transactions stay tied to your account.', 'error'); return; }
    setParsing(true); setProgress({ page: 0, total: 0 });
    try {
      const result = await parseSupportedStatementPdf(file, { sourceApp: forcedSourceApp, onProgress: setProgress });
      if (result.requiresAppChoice && !forcedSourceApp) { setShowUpload(false); setSourcePicker({ file, detection: result.detection }); return; }
      const existingFingerprints = new Set(transactions.map((item) => item.fingerprint));
      const newTransactions = result.transactions.filter((item) => !existingFingerprints.has(item.fingerprint));
      setShowUpload(false);
      setImportReview({ result, newTransactions, duplicateCount: result.transactions.length - newTransactions.length });
    } catch (error) { notify(error.message || 'We could not read that file.', 'error'); }
    finally { setParsing(false); setProgress({ page: 0, total: 0 }); }
  };

  const confirmImport = async () => {
    if (!importReview || !importReview.newTransactions.length) return;
    setSavingImport(true);
    try {
      const merged = mergeTransactions(transactions, importReview.newTransactions);
      if (hasSupabaseConfig && session) await saveCloudTransactions(session.user.id, importReview.newTransactions);
      else writeLocalTransactions(merged.transactions);
      setTransactions(merged.transactions);
      setImportReview(null); setView('dashboard'); setActiveTab('all');
      notify(`${merged.added} ${merged.added === 1 ? 'transaction' : 'transactions'} saved to TrackPay.`);
    } catch (error) { notify(`Could not save imported data: ${error.message}`, 'error'); }
    finally { setSavingImport(false); }
  };

  const onDemo = () => { setDemoMode(true); setView('dashboard'); setActiveTab('all'); setMonthPage(0); };
  const exitDemo = () => { setDemoMode(false); setView('dashboard'); setMonthPage(0); };
  const saveDisplayName = async (name) => {
    setSavingName(true);
    try {
      if (hasSupabaseConfig && session) await saveCloudProfile(session.user.id, name);
      else writeLocalProfile({ displayName: name });
      setDisplayName(String(name || '').trim()); setShowNameEditor(false); notify('Your TrackPay display name was saved.');
    } catch (error) { notify(`Could not save display name: ${error.message}`, 'error'); }
    finally { setSavingName(false); }
  };
  const clearData = async () => {
    if (demoMode) { exitDemo(); notify('Demo mode exited. No demo data was saved.'); return; }
    const message = hasSupabaseConfig ? 'Delete every saved transaction from your TrackPay account? This cannot be undone.' : 'Delete every locally stored TrackPay transaction from this browser? This cannot be undone.';
    if (!window.confirm(message)) return;
    setDeletingData(true);
    try {
      if (hasSupabaseConfig && session) await deleteCloudTransactions(session.user.id); else clearLocalTransactions();
      setTransactions([]); setView('dashboard'); setEntryScreen('splash'); notify('Your saved transaction data was deleted.');
    } catch (error) { notify(`Could not delete saved data: ${error.message}`, 'error'); }
    finally { setDeletingData(false); }
  };
  const deleteAccount = async () => {
    setDeletingAccount(true);
    try {
      await deleteCloudAccount();
      setTransactions([]); setDisplayName(''); setShowAccountDelete(false); setSession(null); setView('dashboard'); setEntryScreen('splash');
      notify('Your TrackPay account and saved data were permanently deleted.');
    } catch (error) { notify(`Could not delete account: ${error.message}. Make sure the secured delete-account Edge Function is deployed.`, 'error'); }
    finally { setDeletingAccount(false); }
  };

  const selectedTransactions = useMemo(() => {
    if (view === 'month') return dataTransactions.filter((transaction) => monthKey(transaction.date) === selectedMonth);
    if (view === 'day') return dataTransactions.filter((transaction) => transaction.date === selectedDay);
    return [];
  }, [dataTransactions, view, selectedMonth, selectedDay]);
  const requestedLegalPage = new URLSearchParams(window.location.search).get('page');
  const legalPage = ['privacy', 'terms', 'help'].includes(requestedLegalPage) ? requestedLegalPage : null;
  const hasData = dataTransactions.length > 0;
  // After one OAuth return we may show the import start once. On later refreshes
  // a signed-in user returns directly to the dashboard, including empty state.
  const showOnboarding = !showUpload && !hasData && (!session || entryScreen === 'import');
  const setTab = (tab) => { if (tab === 'years') setView('yearly'); else { setActiveTab(tab); setView('dashboard'); } };

  return <div className="app-shell"><Header session={session} displayName={displayName} onLogin={onLogin} onLogout={() => setShowLogoutConfirm(true)} cloudMode={hasSupabaseConfig} theme={theme} onTheme={toggleTheme} onEditName={() => setShowNameEditor(true)} onClearData={clearData} onDeleteAccount={() => setShowAccountDelete(true)} demoMode={demoMode} onExitDemo={exitDemo} />{!hasSupabaseConfig && <div className="preview-banner"><Info size={15} /><span><b>Local development:</b> cloud sync is off. Imports stay only in this browser until Supabase is configured.</span>{transactions.length > 0 && !demoMode && <button onClick={clearData}><Trash2 size={14} /> Clear local data</button>}</div>}{legalPage ? <LegalPage page={legalPage} session={session} onDeleteData={clearData} deletingData={deletingData} onAccountDelete={() => setShowAccountDelete(true)} /> : <>{hasSupabaseConfig && !accountReady ? <AccountLoading /> : showOnboarding ? <>{entryScreen === 'splash' ? <SplashPage onBegin={() => setEntryScreen('import')} onSignIn={() => setEntryScreen('signin')} onDemo={onDemo} cloudMode={hasSupabaseConfig} /> : entryScreen === 'signin' ? <SignInPage cloudMode={hasSupabaseConfig} onLogin={onLogin} onContinueLocal={() => setEntryScreen('import')} onDemo={onDemo} onBack={() => setEntryScreen('splash')} /> : <Landing onFile={submitForReview} parsing={parsing} progress={progress} onDemo={onDemo} onLogin={onLogin} cloudMode={hasSupabaseConfig} signedIn={Boolean(session)} onBack={() => setEntryScreen('splash')} />}</> : <>{view === 'dashboard' && <Dashboard transactions={dataTransactions} activeTab={activeTab} onTab={setTab} monthPage={monthPage} setMonthPage={setMonthPage} onMonth={(month) => { setSelectedMonth(month); setView('month'); }} onDay={(day) => { setSelectedDay(day); setView('day'); }} onOpenTransaction={setTransactionDrawer} onUpload={() => setShowUpload(true)} displayName={displayName} demoMode={demoMode} onExitDemo={exitDemo} />}{view === 'month' && <MonthlyDetail month={selectedMonth} transactions={selectedTransactions} onBack={() => setView('dashboard')} onTransaction={setGroupDrawer} />}{view === 'day' && <DailyDetail day={selectedDay} transactions={selectedTransactions} onBack={() => setView('dashboard')} onOpenTransaction={setTransactionDrawer} />}{view === 'yearly' && <YearlyAnalysis transactions={dataTransactions} onBack={() => setView('dashboard')} onUpload={() => demoMode ? exitDemo() : setShowUpload(true)} onMonthly={() => setTab('monthly')} onDaily={() => setTab('daily')} onOpenGroup={setGroupDrawer} />}</>}</>}<Footer />{showUpload && <div className="modal-backdrop" onMouseDown={() => !parsing && setShowUpload(false)}><section className="upload-modal" onMouseDown={(event) => event.stopPropagation()}><button className="icon-button drawer-close" onClick={() => !parsing && setShowUpload(false)} aria-label="Close"><X size={19} /></button><UploadPanel onFile={submitForReview} parsing={parsing} progress={progress} compact /><GettingStarted /></section></div>}{sourcePicker && <SourcePicker detection={sourcePicker.detection} onClose={() => setSourcePicker(null)} onSelect={(sourceApp) => { const { file } = sourcePicker; setSourcePicker(null); submitForReview(file, sourceApp); }} />}{importReview && <ImportReview review={importReview} onConfirm={confirmImport} onClose={() => setImportReview(null)} saving={savingImport} />}{showNameEditor && <DisplayNameModal initialName={displayName} onSave={saveDisplayName} onClose={() => setShowNameEditor(false)} saving={savingName} />}{showAccountDelete && <DeleteAccountModal onDelete={deleteAccount} onClose={() => setShowAccountDelete(false)} deleting={deletingAccount} />}{showLogoutConfirm && <LogoutModal onLogout={onLogout} onClose={() => setShowLogoutConfirm(false)} signingOut={signingOut} />}{transactionDrawer && <TransactionDrawer transaction={transactionDrawer} onClose={() => setTransactionDrawer(null)} />}{groupDrawer && <GroupTransactionsDrawer transactions={groupDrawer} onClose={() => setGroupDrawer(null)} onOpen={(transaction) => { setGroupDrawer(null); setTransactionDrawer(transaction); }} />}<Toast message={toast} onClose={() => setToast(null)} /></div>;
}

export default App;
