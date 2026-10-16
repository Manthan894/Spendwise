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
  IndianRupee,
  Info,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  Menu,
  Plus,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react';
import YearlyAnalysis from './components/YearlyAnalysis';
import { parsePhonePePdf } from './lib/parser';
import { hasSupabaseConfig, signInWithGoogle, supabase } from './lib/supabase';
import { productConfig } from './config';
import {
  clearLocalTransactions,
  deleteCloudTransactions,
  fetchCloudTransactions,
  mergeTransactions,
  readLocalTransactions,
  saveCloudTransactions,
  writeLocalTransactions,
} from './lib/storage';

const DEMO_TRANSACTIONS = [
  { date: '2026-10-08', time: '08:35 PM', type: 'DEBIT', amountPaise: 1000, counterparty: 'Campus Stationery', transactionId: 'DEMO-1001', description: 'Paid to Campus Stationery' },
  { date: '2026-10-08', time: '03:41 PM', type: 'DEBIT', amountPaise: 2000, counterparty: 'Evening Bakery', transactionId: 'DEMO-1002', description: 'Paid to Evening Bakery' },
  { date: '2026-10-08', time: '03:39 PM', type: 'DEBIT', amountPaise: 2000, counterparty: 'Campus Canteen', transactionId: 'DEMO-1003', description: 'Paid to Campus Canteen' },
  { date: '2026-10-07', time: '07:08 PM', type: 'DEBIT', amountPaise: 1600, counterparty: 'Campus Canteen', transactionId: 'DEMO-1004', description: 'Paid to Campus Canteen' },
  { date: '2026-10-07', time: '04:16 PM', type: 'CREDIT', amountPaise: 3000, counterparty: 'Aarav', transactionId: 'DEMO-1005', description: 'Received from Aarav' },
  { date: '2026-10-06', time: '01:24 PM', type: 'DEBIT', amountPaise: 7000, counterparty: 'Lunch Corner', transactionId: 'DEMO-1006', description: 'Paid to Lunch Corner' },
  { date: '2026-09-21', time: '08:10 PM', type: 'DEBIT', amountPaise: 5000, counterparty: 'Riya', transactionId: 'DEMO-1007', description: 'Paid to Riya' },
  { date: '2026-09-18', time: '12:45 PM', type: 'DEBIT', amountPaise: 12000, counterparty: 'Hostel Store', transactionId: 'DEMO-1008', description: 'Paid to Hostel Store' },
];

function money(paise, withSign = false) {
  const value = Math.abs(Number(paise || 0)) / 100;
  const output = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value % 1 ? 2 : 0,
  }).format(value);
  return withSign && paise < 0 ? `−${output}` : output;
}

function monthKey(date) {
  return date?.slice(0, 7);
}

function formatMonth(key) {
  if (!key) return '';
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1));
}

function formatShortMonth(key) {
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit' })
    .format(new Date(year, month - 1, 1));
}

function formatDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day));
}

function formatDateLong(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, day));
}

function totalOf(items, type) {
  return items.filter((item) => item.type === type).reduce((sum, item) => sum + Number(item.amountPaise || 0), 0);
}

function groupByCounterparty(items) {
  const groups = new Map();
  for (const item of items) {
    const key = (item.counterparty || 'Unknown counterparty').trim().toLocaleLowerCase();
    const existing = groups.get(key) || {
      name: item.counterparty || 'Unknown counterparty', paid: 0, received: 0, count: 0, transactions: [],
    };
    if (item.type === 'DEBIT') existing.paid += Number(item.amountPaise || 0);
    else existing.received += Number(item.amountPaise || 0);
    existing.count += 1;
    existing.transactions.push(item);
    groups.set(key, existing);
  }
  return [...groups.values()].sort((a, b) => Math.max(b.paid, b.received) - Math.max(a.paid, a.received));
}

function buildDemoTransactions() {
  return DEMO_TRANSACTIONS.map((transaction) => ({
    ...transaction,
    fingerprint: `demo-${transaction.transactionId.toLowerCase()}`,
    page: 1,
  }));
}

function Logo({ compact = false }) {
  return (
    <div className="brand" aria-label="Spendwise">
      <span className="brand-mark"><WalletCards size={compact ? 17 : 19} strokeWidth={2.4} /></span>
      {!compact && <span>Spendwise</span>}
    </div>
  );
}

function Toast({ message, onClose }) {
  if (!message) return null;
  return (
    <div className={`toast ${message.kind || 'info'}`} role="status">
      {message.kind === 'error' ? <Info size={18} /> : <CheckCircle2 size={18} />}
      <span>{message.text}</span>
      <button onClick={onClose} aria-label="Close message"><X size={16} /></button>
    </div>
  );
}

function UploadPanel({ onFile, parsing, progress, compact = false }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const acceptFile = (file) => {
    if (file) onFile(file);
  };

  return (
    <section className={`upload-panel ${compact ? 'compact' : ''}`}>
      {!compact && <div className="eyebrow"><Sparkles size={15} /> Private PDF import</div>}
      <h2>{compact ? 'Add another statement' : 'Upload your PhonePe statement'}</h2>
      <p>{compact ? 'Import another month or update your records. Duplicate transactions are skipped.' : 'Turn a long statement into a clear view of where your money went.'}</p>
      <div
        className={`dropzone ${dragging ? 'dragging' : ''} ${parsing ? 'disabled' : ''}`}
        onDragOver={(event) => { event.preventDefault(); if (!parsing) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!parsing) acceptFile(event.dataTransfer.files?.[0]);
        }}
        onClick={() => !parsing && inputRef.current?.click()}
        role="button"
        tabIndex="0"
        onKeyDown={(event) => { if (event.key === 'Enter' && !parsing) inputRef.current?.click(); }}
      >
        <span className="upload-orb">{parsing ? <LoaderCircle className="spin" size={25} /> : <UploadCloud size={25} />}</span>
        <strong>{parsing ? `Reading page ${progress.page} of ${progress.total}…` : 'Drop your PDF here'}</strong>
        <span>{parsing ? 'The file stays in this browser.' : 'or click to choose a file · PDF only'}</span>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={(event) => acceptFile(event.target.files?.[0])} hidden />
      </div>
      <div className="privacy-line"><LockKeyhole size={15} /><span>Your original PDF never leaves this device.</span></div>
    </section>
  );
}

function GettingStarted() {
  return (
    <aside className="how-card">
      <div className="section-icon lavender"><CircleHelp size={19} /></div>
      <div>
        <h3>How to get your PDF</h3>
        <p>Download a statement inside PhonePe, then return here to import it.</p>
      </div>
      <ol className="steps">
        <li><span>1</span><div><b>Open PhonePe</b><small>Go to your profile or account section.</small></div></li>
        <li><span>2</span><div><b>Find “My Statements”</b><small>Select the date range you want to review.</small></div></li>
        <li><span>3</span><div><b>Download PDF</b><small>Upload the original text-based PDF here.</small></div></li>
      </ol>
    </aside>
  );
}

function Landing({ onFile, parsing, progress, onDemo, canDemo, onLogin, isCloudMode }) {
  return (
    <main className="landing shell">
      <section className="hero-copy">
        <div className="eyebrow"><Sparkles size={15} /> Money clarity for student life</div>
        <h1>See where your<br /><em>money goes.</em></h1>
        <p>Spendwise reads your PhonePe statement on your device and combines repeat payments by person or shop.</p>
        <div className="trust-row">
          <span><ShieldCheck size={17} /> PDF stays private</span>
          <span><Cloud size={17} /> Your data, on every device</span>
        </div>
      </section>
      <div className="landing-action">
        <UploadPanel onFile={onFile} parsing={parsing} progress={progress} />
        <GettingStarted />
        {!isCloudMode && canDemo && (
          <button className="text-button demo-button" onClick={onDemo}><Sparkles size={16} /> Explore with safe demo data</button>
        )}
        {isCloudMode && <button className="text-button demo-button" onClick={onLogin}><LogIn size={16} /> Sign in with Google to save your data</button>}
      </div>
    </main>
  );
}

function SummaryCard({ label, value, icon, tone, helper }) {
  return (
    <div className={`summary-card ${tone}`}>
      <div className="summary-icon">{icon}</div>
      <div><span>{label}</span><strong>{value}</strong>{helper && <small>{helper}</small>}</div>
    </div>
  );
}

function TransactionType({ type }) {
  return <span className={`type-pill ${type === 'CREDIT' ? 'credit' : 'debit'}`}>{type === 'CREDIT' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}{type === 'CREDIT' ? 'Credit' : 'Debit'}</span>;
}

function MonthCard({ month, items, onClick }) {
  const debit = totalOf(items, 'DEBIT');
  const credit = totalOf(items, 'CREDIT');
  return (
    <button className="month-card" onClick={onClick}>
      <div className="month-card-top"><span className="calendar-mini"><CalendarDays size={16} /></span><span>{formatMonth(month)}</span><ArrowRight size={17} /></div>
      <div className="month-total"><span>Paid</span><strong>{money(debit)}</strong></div>
      <div className="month-meta"><span>{items.length} {items.length === 1 ? 'transaction' : 'transactions'}</span>{credit > 0 && <span className="received-mini">+ {money(credit)} received</span>}</div>
    </button>
  );
}

function DayCard({ day, items, onClick }) {
  const debit = totalOf(items, 'DEBIT');
  const credit = totalOf(items, 'CREDIT');
  return (
    <button className="day-card" onClick={onClick}>
      <div className="day-card-date"><span>{formatDate(day)}</span><small>{items.length} entries</small></div>
      <div className="day-card-amount"><strong>{money(debit)}</strong><small>{credit ? `+${money(credit)} in` : 'paid'}</small></div>
      <ArrowRight size={17} />
    </button>
  );
}

function Overview({ transactions, activeTab, setActiveTab, monthPage, setMonthPage, onMonth, onDay, onYearly, onUpload }) {
  const monthItems = useMemo(() => {
    const map = new Map();
    for (const transaction of transactions) {
      const key = monthKey(transaction.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(transaction);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [transactions]);
  const visibleMonths = monthItems.slice(monthPage * 12, (monthPage + 1) * 12);
  const visibleSet = new Set(visibleMonths.map(([key]) => key));
  const dayItems = useMemo(() => {
    const map = new Map();
    for (const transaction of transactions) {
      if (!visibleSet.has(monthKey(transaction.date))) continue;
      if (!map.has(transaction.date)) map.set(transaction.date, []);
      map.get(transaction.date).push(transaction);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [transactions, visibleMonths]);
  const paid = totalOf(transactions, 'DEBIT');
  const received = totalOf(transactions, 'CREDIT');
  const canShowOlder = (monthPage + 1) * 12 < monthItems.length;

  return (
    <main className="dashboard shell">
      <section className="dashboard-heading">
        <div><div className="eyebrow"><Sparkles size={15} /> Your private overview</div><h1>Good to see you.</h1><p>Every payment, organised without the spreadsheet.</p></div>
        <button className="primary-button" onClick={onUpload}><Plus size={18} /> Upload statement</button>
      </section>
      <section className="summary-grid">
        <SummaryCard label="Total paid" value={money(paid)} helper="Across imported statements" icon={<ArrowUpRight size={20} />} tone="purple" />
        <SummaryCard label="Money received" value={money(received)} helper="Credits & transfers in" icon={<ArrowDownLeft size={20} />} tone="green" />
        <SummaryCard label="Transactions" value={transactions.length.toLocaleString('en-IN')} helper="Duplicates are skipped" icon={<ReceiptText size={20} />} tone="orange" />
      </section>
      <section className="data-section">
        <div className="section-heading">
          <div><h2>Your statements</h2><p>Only months found in your imported PDFs appear below.</p></div>
          <div className="segmented three-options" aria-label="Statement grouping">
            <button className={activeTab === 'monthly' ? 'active' : ''} onClick={() => setActiveTab('monthly')}><CalendarDays size={15} /> Monthly</button>
            <button className={activeTab === 'daily' ? 'active' : ''} onClick={() => setActiveTab('daily')}><ReceiptText size={15} /> Daily</button>
            <button onClick={onYearly}><Sparkles size={15} /> Yearly</button>
          </div>
        </div>
        {monthItems.length > 12 && <div className="twelve-note"><Info size={15} /> Showing 12 months at a time. Use the arrows to move through your history.</div>}
        <div className={activeTab === 'monthly' ? 'months-grid' : 'days-list'}>
          {activeTab === 'monthly'
            ? visibleMonths.map(([month, items]) => <MonthCard key={month} month={month} items={items} onClick={() => onMonth(month)} />)
            : dayItems.map(([day, items]) => <DayCard key={day} day={day} items={items} onClick={() => onDay(day)} />)}
        </div>
        {monthItems.length > 12 && <div className="pagination">
          <button disabled={monthPage === 0} onClick={() => setMonthPage(Math.max(0, monthPage - 1))}><ArrowLeft size={16} /> Newer</button>
          <span>{monthPage * 12 + 1}–{Math.min((monthPage + 1) * 12, monthItems.length)} of {monthItems.length} months</span>
          <button disabled={!canShowOlder} onClick={() => setMonthPage(monthPage + 1)}>Older <ArrowRight size={16} /></button>
        </div>}
      </section>
    </main>
  );
}

function BackButton({ onClick, children = 'Back to overview' }) {
  return <button className="back-button" onClick={onClick}><ArrowLeft size={17} />{children}</button>;
}

function MonthlyDetail({ month, transactions, onBack, onTransaction }) {
  const groups = groupByCounterparty(transactions);
  const paid = totalOf(transactions, 'DEBIT');
  const received = totalOf(transactions, 'CREDIT');
  return (
    <main className="detail-page shell">
      <BackButton onClick={onBack} />
      <header className="detail-heading"><div><div className="eyebrow"><CalendarDays size={15} /> Monthly breakdown</div><h1>{formatMonth(month)}</h1><p>Repeat payments are combined by the same person or shop.</p></div><div className="detail-total"><span>Total paid</span><strong>{money(paid)}</strong>{received > 0 && <small>{money(received)} received</small>}</div></header>
      <section className="group-list">
        <div className="group-list-head"><span>Person or shop</span><span>Activity</span><span>Paid</span></div>
        {groups.map((group) => (
          <article className="group-row" key={group.name}>
            <div className="counterparty"><span className="avatar">{group.name.charAt(0).toUpperCase()}</span><div><strong>{group.name}</strong><small>{group.count} {group.count === 1 ? 'transaction' : 'transactions'}</small></div></div>
            <div className="group-flow">{group.paid > 0 && <span className="outflow"><ArrowUpRight size={14} /> {money(group.paid)}</span>}{group.received > 0 && <span className="inflow"><ArrowDownLeft size={14} /> {money(group.received)}</span>}</div>
            <strong className="group-paid">{group.paid ? money(group.paid) : '—'}</strong>
            <button className="row-arrow" aria-label={`View ${group.name} transactions`} onClick={() => onTransaction(group.transactions)}><ChevronDown size={17} /></button>
          </article>
        ))}
      </section>
      <p className="detail-footnote"><ShieldCheck size={16} /> Names are grouped exactly as they appear in PhonePe. Spendwise does not merge similar-looking names.</p>
    </main>
  );
}

function DailyDetail({ day, transactions, onBack, onOpenTransaction }) {
  const paid = totalOf(transactions, 'DEBIT');
  const received = totalOf(transactions, 'CREDIT');
  return (
    <main className="detail-page shell">
      <BackButton onClick={onBack} />
      <header className="detail-heading"><div><div className="eyebrow"><ReceiptText size={15} /> Daily transactions</div><h1>{formatDateLong(day)}</h1><p>{transactions.length} {transactions.length === 1 ? 'entry' : 'entries'} from your statement.</p></div><div className="detail-total"><span>Paid today</span><strong>{money(paid)}</strong>{received > 0 && <small>{money(received)} received</small>}</div></header>
      <TransactionTable transactions={transactions} onOpen={onOpenTransaction} />
    </main>
  );
}

function TransactionTable({ transactions, onOpen }) {
  return (
    <section className="transaction-table">
      <div className="transaction-table-head"><span>Transaction details</span><span>Type</span><span>Amount</span><span /></div>
      {transactions.map((transaction) => (
        <button className="transaction-row" key={transaction.fingerprint} onClick={() => onOpen(transaction)}>
          <div className="transaction-main"><span className={`transaction-icon ${transaction.type === 'CREDIT' ? 'in' : ''}`}>{transaction.type === 'CREDIT' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</span><div><strong>{transaction.description || (transaction.type === 'CREDIT' ? `Received from ${transaction.counterparty}` : `Paid to ${transaction.counterparty}`)}</strong><small>{transaction.time || 'Time unavailable'}{transaction.utr ? ` · UTR ${transaction.utr}` : ''}</small></div></div>
          <TransactionType type={transaction.type} />
          <strong className={transaction.type === 'CREDIT' ? 'amount-credit' : ''}>{transaction.type === 'CREDIT' ? '+' : '−'}{money(transaction.amountPaise)}</strong>
          <ArrowRight className="row-open" size={17} />
        </button>
      ))}
    </section>
  );
}

function TransactionDrawer({ transaction, onClose }) {
  if (!transaction) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="transaction-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button drawer-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
        <span className={`drawer-icon ${transaction.type === 'CREDIT' ? 'in' : ''}`}>{transaction.type === 'CREDIT' ? <ArrowDownLeft size={22} /> : <ArrowUpRight size={22} />}</span>
        <TransactionType type={transaction.type} />
        <h2>{transaction.counterparty}</h2>
        <strong className={transaction.type === 'CREDIT' ? 'amount-credit big-amount' : 'big-amount'}>{transaction.type === 'CREDIT' ? '+' : '−'}{money(transaction.amountPaise)}</strong>
        <dl className="transaction-meta"><div><dt>Date</dt><dd>{formatDate(transaction.date)}</dd></div><div><dt>Time</dt><dd>{transaction.time || 'Not in statement'}</dd></div>{transaction.transactionId && <div><dt>Transaction ID</dt><dd>{transaction.transactionId}</dd></div>}{transaction.utr && <div><dt>UTR number</dt><dd>{transaction.utr}</dd></div>}{transaction.accountLast4 && <div><dt>Account ending</dt><dd>•••• {transaction.accountLast4}</dd></div>}</dl>
      </section>
    </div>
  );
}

function GroupTransactionsDrawer({ transactions, onClose, onOpen }) {
  if (!transactions) return null;
  const group = transactions[0];
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="transaction-drawer group-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button drawer-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
        <div className="eyebrow"><UsersRound size={15} /> All matching entries</div>
        <h2>{group?.counterparty}</h2>
        <p>{transactions.length} transactions appear with this exact PhonePe name.</p>
        <div className="small-transactions">{transactions.map((transaction) => <button key={transaction.fingerprint} onClick={() => onOpen(transaction)}><span><b>{formatDate(transaction.date)}</b><small>{transaction.time || 'Time unavailable'} · {transaction.type}</small></span><strong className={transaction.type === 'CREDIT' ? 'amount-credit' : ''}>{transaction.type === 'CREDIT' ? '+' : '−'}{money(transaction.amountPaise)}</strong></button>)}</div>
      </section>
    </div>
  );
}

function SupportEmail() {
  if (productConfig.supportEmailIsPlaceholder) {
    return <span className="placeholder-email" title="Replace this address before the public launch">{productConfig.supportEmail}</span>;
  }
  return <a className="support-email" href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a>;
}

function LegalPage({ page, session, onDeleteData, deleting }) {
  const titles = {
    privacy: ['Privacy Policy', 'Clear, simple information about how Spendwise handles your data.'],
    terms: ['Terms of Use', 'The rules for using Spendwise responsibly.'],
    help: ['Help & Contact', 'Answers about statements, accounts, and your data.'],
  };
  const [title, subtitle] = titles[page] || titles.privacy;

  return (
    <main className="legal-page shell">
      <a className="back-button" href="/"><ArrowLeft size={17} />Back to Spendwise</a>
      <header className="legal-heading">
        <div className="eyebrow"><ShieldCheck size={15} /> Spendwise information centre</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <small>Last updated: {productConfig.policyLastUpdated}</small>
      </header>

      {page === 'privacy' && <div className="legal-content">
        <section><h2>1. Who we are</h2><p>Spendwise is an independent student project that helps people organise transactions from PhonePe statements. In this policy, “we”, “us”, and “Spendwise” mean {productConfig.policyOwner}.</p></section>
        <section><h2>2. Your statement PDF stays on your device</h2><p>Spendwise reads an original, text-based PhonePe PDF inside your browser. The PDF file itself is not uploaded to our server, Supabase, AWS Amplify, or another storage service. We do not keep a copy of the PDF.</p></section>
        <section><h2>3. Information saved after you sign in</h2><p>When you choose to import a statement while signed in, Spendwise may save extracted transaction fields: date, time, debit or credit type, amount, counterparty name, transaction ID, UTR number, masked account suffix, and the imported file name. We use basic Google account information supplied through Google Sign-In, such as your email address and profile name, to identify your account.</p></section>
        <section><h2>4. Why we use this information</h2><p>We use this information only to show your transaction history, monthly groups, daily details, duplicate protection, and cross-device access for your signed-in Spendwise account. Spendwise does not request access to your Gmail, Google Drive, contacts, calendar, or other Google data.</p></section>
        <section><h2>5. Where data is kept and protected</h2><p>Extracted transaction data is stored in Supabase after sign-in. Our database rules are designed so that each signed-in user can access only their own transaction rows. The Spendwise web interface is hosted through AWS Amplify. No online service can promise absolute security, but we use account-based access controls and Row Level Security to reduce unauthorised access.</p></section>
        <section><h2>6. Your choices and deletion</h2><p>You can delete all imported transaction records from inside your signed-in Spendwise account. This removes stored transaction rows but does not delete your Google account itself. For an account-deletion request or questions about your data, contact <SupportEmail />.</p>{productConfig.supportEmailIsPlaceholder && <p className="temporary-note"><Info size={15} /> A dedicated support address is being prepared. This placeholder must be replaced before public launch.</p>}</section>
        <section><h2>7. Sharing and selling</h2><p>Spendwise does not sell personal data or transaction data. We do not intentionally share transaction data with advertisers. Service providers used to operate the app, such as Supabase and AWS Amplify, process only what is needed to provide the service.</p></section>
        <section><h2>8. Changes to this policy</h2><p>We may update this policy as Spendwise develops. The latest version will be available on this page with an updated date.</p></section>
      </div>}

      {page === 'terms' && <div className="legal-content">
        <section><h2>1. Using Spendwise</h2><p>Spendwise is intended to help students organise their own PhonePe statement transactions. Use it only with statements you are authorised to access. Do not upload another person’s statement without their clear permission.</p></section>
        <section><h2>2. What Spendwise does</h2><p>Spendwise extracts text from supported PhonePe PDF statements, shows individual transactions, and groups exact matching counterparty names. It does not provide financial, tax, legal, investment, or banking advice.</p></section>
        <section><h2>3. Accuracy and review</h2><p>PDF layouts and names can vary. You should review your imported data before relying on it. Spendwise does not merge similar-looking names and should not be treated as an official PhonePe record.</p></section>
        <section><h2>4. Your account</h2><p>You sign in through Google. Keep control of your Google account and sign out from shared devices. You are responsible for activity performed through your account.</p></section>
        <section><h2>5. Availability</h2><p>Spendwise is an evolving student project and may change, be paused, or be unavailable from time to time. We may update or remove features as the product develops.</p></section>
        <section><h2>6. Privacy and deletion</h2><p>Our handling of statement data is explained in the <a href="?page=privacy">Privacy Policy</a>. You can remove imported transactions from within the product. For account-deletion questions, contact <SupportEmail />.</p></section>
        <section><h2>7. Contact</h2><p>Questions about these terms can be sent to <SupportEmail />.</p></section>
      </div>}

      {page === 'help' && <div className="legal-content help-content">
        <section><h2>How do I import a PhonePe statement?</h2><ol><li>Open PhonePe and find your statements or transaction history.</li><li>Choose the date range and download the original PDF.</li><li>Sign in to Spendwise with Google, then upload the PDF.</li><li>Wait for Spendwise to read the transaction text on your device.</li></ol><p>Image-only PDFs, screenshots, and scanned pages cannot be read reliably yet.</p></section>
        <section><h2>Does Spendwise upload my PDF?</h2><p>No. The PDF is read in your browser. Only extracted transaction fields are saved after you sign in, so your account can show the same data on another device.</p></section>
        <section><h2>Why is a transaction missing or grouped separately?</h2><p>Spendwise groups only exact PhonePe names. For example, “Friend-1” and “Friend-1K” remain separate. A statement with no selectable text may also need the original PhonePe PDF rather than a scan.</p></section>
        <section className="data-control"><h2>Manage your imported data</h2><p>Deleting imported data permanently removes all transaction records stored for your signed-in Spendwise account. It does not delete your Google account.</p>{session ? <button className="danger-button" disabled={deleting} onClick={onDeleteData}>{deleting ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}{deleting ? 'Deleting imported data…' : 'Delete all imported data'}</button> : <p className="signin-note"><LockKeyhole size={15} /> Sign in to manage imported data.</p>}<p className="support-copy">For an account-deletion request or support, contact <SupportEmail />.</p>{productConfig.supportEmailIsPlaceholder && <p className="temporary-note"><Info size={15} /> This address is temporary and will be replaced before public launch.</p>}</section>
        <section><h2>Contact</h2><p>Need help? Contact <SupportEmail />. We aim to add a dedicated support address before Spendwise is opened to the public.</p></section>
      </div>}
    </main>
  );
}

function Footer() {
  return <footer><Logo /><span>Private by design. Built for student spending clarity.</span><nav className="footer-links"><a href="?page=privacy">Privacy</a><a href="?page=terms">Terms</a><a href="?page=help">Help & Contact</a></nav><span>© {new Date().getFullYear()} Spendwise</span></footer>;
}

function Header({ session, onLogin, onLogout, cloudMode }) {
  const name = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0];
  return <header className="site-header"><div className="header-inner"><a href="/" aria-label="Spendwise home"><Logo /></a><nav><a href="?page=privacy">Privacy</a><a href="?page=help">How it works</a></nav><div className="header-actions">{session ? <><span className="user-chip">{session.user.user_metadata?.avatar_url ? <img src={session.user.user_metadata.avatar_url} alt="" /> : <span>{name?.charAt(0)?.toUpperCase()}</span>}{name}</span><button className="icon-button" onClick={onLogout} title="Sign out"><LogOut size={18} /></button></> : cloudMode ? <button className="login-button" onClick={onLogin}><LogIn size={17} /> Continue with Google</button> : <span className="local-chip"><Landmark size={14} /> Local preview</span>}<a className="mobile-menu" href="?page=help" aria-label="Open help and information"><Menu size={19} /></a></div></div></header>;
}

function PrivacyModal({ onClose }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="privacy-modal" onMouseDown={(event) => event.stopPropagation()}><button className="icon-button drawer-close" onClick={onClose} aria-label="Close"><X size={19} /></button><span className="privacy-shield"><ShieldCheck size={26} /></span><h2>Your statement remains private</h2><p>Spendwise reads the PDF with code running in your browser. The file is not uploaded, stored, or shared.</p><div className="privacy-points"><span><CheckCircle2 size={17} /> PDF parsing happens on-device</span><span><CheckCircle2 size={17} /> Only extracted transaction fields sync after you sign in</span><span><CheckCircle2 size={17} /> Supabase row-level security isolates each account</span></div><button className="primary-button full-button" onClick={onClose}>Got it</button></section></div>;
}

function App() {
  const [session, setSession] = useState(null);
  const [transactions, setTransactions] = useState(() => hasSupabaseConfig ? [] : readLocalTransactions());
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState({ page: 0, total: 0 });
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState('monthly');
  const [view, setView] = useState('overview');
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [monthPage, setMonthPage] = useState(0);
  const [showUpload, setShowUpload] = useState(false);
  const [transactionDrawer, setTransactionDrawer] = useState(null);
  const [groupDrawer, setGroupDrawer] = useState(null);
  const [deletingData, setDeletingData] = useState(false);

  const notify = (text, kind = 'success') => {
    setToast({ text, kind });
    window.setTimeout(() => setToast(null), 4800);
  };

  useEffect(() => {
    if (!supabase) return undefined;
    let alive = true;
    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (alive) setSession(data.session);
      if (data.session) {
        try {
          const cloudTransactions = await fetchCloudTransactions();
          if (alive) setTransactions(cloudTransactions);
        } catch (error) {
          if (alive) notify(`Could not load cloud data: ${error.message}`, 'error');
        }
      }
    };
    loadSession();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) {
        setTransactions([]);
        setView('overview');
      } else {
        window.setTimeout(async () => {
          try { if (alive) setTransactions(await fetchCloudTransactions()); } catch (error) { if (alive) notify(`Could not load cloud data: ${error.message}`, 'error'); }
        }, 0);
      }
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  const onLogin = async () => {
    try { await signInWithGoogle(); } catch (error) { notify(error.message, 'error'); }
  };

  const onLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    notify('Signed out. Your cloud data remains securely stored.', 'success');
  };

  const saveNewTransactions = async (incoming, sourceFileName) => {
    const merged = mergeTransactions(transactions, incoming);
    setTransactions(merged.transactions);
    if (hasSupabaseConfig && session) {
      await saveCloudTransactions(session.user.id, incoming, sourceFileName);
    } else {
      writeLocalTransactions(merged.transactions);
    }
    return merged.added;
  };

  const onFile = async (file) => {
    if (!file || parsing) return;
    if (hasSupabaseConfig && !session) {
      notify('Please continue with Google before importing, so your transactions stay tied to your account.', 'error');
      return;
    }
    setParsing(true);
    setProgress({ page: 0, total: 0 });
    try {
      const result = await parsePhonePePdf(file, setProgress);
      const added = await saveNewTransactions(result.transactions, file.name);
      setShowUpload(false);
      setView('overview');
      const duplicateText = result.transactions.length - added;
      notify(`${added} ${added === 1 ? 'transaction' : 'transactions'} imported${duplicateText ? ` · ${duplicateText} duplicate${duplicateText === 1 ? '' : 's'} skipped` : ''}.`);
      if (result.issues.length) notify(`${added} imported. ${result.issues[0]}`, 'error');
    } catch (error) {
      notify(error.message || 'We could not read that file.', 'error');
    } finally {
      setParsing(false);
      setProgress({ page: 0, total: 0 });
    }
  };

  const onDemo = async () => {
    const demo = buildDemoTransactions();
    const merged = mergeTransactions(transactions, demo);
    setTransactions(merged.transactions);
    writeLocalTransactions(merged.transactions);
    notify('Demo data loaded. It is generic and stored only in this browser.');
  };

  const selectedTransactions = useMemo(() => {
    if (view === 'month') return transactions.filter((transaction) => monthKey(transaction.date) === selectedMonth);
    if (view === 'day') return transactions.filter((transaction) => transaction.date === selectedDay);
    return [];
  }, [transactions, view, selectedMonth, selectedDay]);

  const eraseLocalPreview = () => {
    if (!window.confirm('Remove every locally stored preview transaction from this browser?')) return;
    clearLocalTransactions();
    setTransactions([]);
    setView('overview');
    notify('Local preview data removed.');
  };

  const deleteAllImportedData = async () => {
    const message = hasSupabaseConfig
      ? 'Delete every imported transaction from your Spendwise account? This cannot be undone.'
      : 'Delete every locally stored preview transaction from this browser? This cannot be undone.';
    if (!window.confirm(message)) return;
    setDeletingData(true);
    try {
      if (hasSupabaseConfig && session) {
        await deleteCloudTransactions(session.user.id);
      } else {
        clearLocalTransactions();
      }
      setTransactions([]);
      setView('overview');
      notify('Your imported transaction data has been deleted.');
    } catch (error) {
      notify(`Could not delete imported data: ${error.message}`, 'error');
    } finally {
      setDeletingData(false);
    }
  };

  const requestedLegalPage = new URLSearchParams(window.location.search).get('page');
  const legalPage = ['privacy', 'terms', 'help'].includes(requestedLegalPage) ? requestedLegalPage : null;
  const hasData = transactions.length > 0;

  return (
    <div className="app-shell">
      <Header session={session} onLogin={onLogin} onLogout={onLogout} cloudMode={hasSupabaseConfig} />
      {!hasSupabaseConfig && <div className="preview-banner"><Info size={15} /><span><b>Preview mode:</b> add Supabase environment variables to enable Google sign-in and encrypted account-based sync.</span>{hasData && <button onClick={eraseLocalPreview}><Trash2 size={14} /> Clear local data</button>}</div>}
      {legalPage ? <LegalPage page={legalPage} session={session} onDeleteData={deleteAllImportedData} deleting={deletingData} /> : <>
        {!hasData && !showUpload ? <Landing onFile={onFile} parsing={parsing} progress={progress} onDemo={onDemo} canDemo={!hasSupabaseConfig} onLogin={onLogin} isCloudMode={hasSupabaseConfig} /> : <>
          {view === 'overview' && <Overview transactions={transactions} activeTab={activeTab} setActiveTab={setActiveTab} monthPage={monthPage} setMonthPage={setMonthPage} onMonth={(month) => { setSelectedMonth(month); setView('month'); }} onDay={(day) => { setSelectedDay(day); setView('day'); }} onYearly={() => setView('yearly')} onUpload={() => setShowUpload(true)} />}
          {view === 'month' && <MonthlyDetail month={selectedMonth} transactions={selectedTransactions} onBack={() => setView('overview')} onTransaction={(items) => setGroupDrawer(items)} />}
          {view === 'day' && <DailyDetail day={selectedDay} transactions={selectedTransactions} onBack={() => setView('overview')} onOpenTransaction={setTransactionDrawer} />}
          {view === 'yearly' && <YearlyAnalysis transactions={transactions} onBack={() => setView('overview')} onUpload={() => setShowUpload(true)} onMonthly={() => { setActiveTab('monthly'); setView('overview'); }} onDaily={() => { setActiveTab('daily'); setView('overview'); }} onOpenGroup={setGroupDrawer} />}
        </>}
      </>}
      {showUpload && <div className="modal-backdrop" onMouseDown={() => !parsing && setShowUpload(false)}><section className="upload-modal" onMouseDown={(event) => event.stopPropagation()}><button className="icon-button drawer-close" onClick={() => !parsing && setShowUpload(false)} aria-label="Close"><X size={19} /></button><UploadPanel onFile={onFile} parsing={parsing} progress={progress} compact /><GettingStarted /></section></div>}
      <TransactionDrawer transaction={transactionDrawer} onClose={() => setTransactionDrawer(null)} />
      <GroupTransactionsDrawer transactions={groupDrawer} onClose={() => setGroupDrawer(null)} onOpen={(transaction) => { setGroupDrawer(null); setTransactionDrawer(transaction); }} />
      <Toast message={toast} onClose={() => setToast(null)} />
      <Footer />
    </div>
  );
}

export default App;
