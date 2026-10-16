import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarRange,
  ChevronDown,
  FileUp,
  Info,
  ReceiptText,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import {
  formatAnalysisMonth,
  getYearlyEligibility,
  rankYearlyCounterparties,
  transactionsForYearlyPeriod,
  yearlyTotals,
} from '../lib/yearlyAnalysis';

function money(paise) {
  const value = Math.abs(Number(paise || 0)) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value % 1 ? 2 : 0,
  }).format(value);
}

function PeriodOption({ period }) {
  return <option value={period.id}>{period.label} · {period.kind}</option>;
}

function YearlyUnavailable({ eligibility, onBack, onUpload, onMonthly, onDaily }) {
  const hasAnyHistory = eligibility.presentMonths.length > 0;
  const run = eligibility.longestRun;
  const runLabel = run ? `${formatAnalysisMonth(run.startMonth)} – ${formatAnalysisMonth(run.endMonth)}` : 'No imported transaction months yet';
  const gapsExist = eligibility.presentMonths.length >= 12 && eligibility.longestLength < 12;

  return (
    <main className="yearly-page shell yearly-unavailable-page">
      <button className="back-button" onClick={onBack}><ArrowLeft size={17} />Back to overview</button>
      <section className="yearly-unavailable-card">
        <span className="yearly-empty-icon"><CalendarRange size={28} /></span>
        <div className="eyebrow"><BarChart3 size={15} /> Yearly analysis</div>
        <h1>Yearly analysis needs 12 continuous months.</h1>
        {hasAnyHistory ? <>
          <p>Your longest uninterrupted transaction history is <strong>{eligibility.longestLength} of 12 months</strong>.</p>
          <div className="history-progress" aria-label={`${eligibility.longestLength} of 12 months available`}><span style={{ width: `${Math.min(100, (eligibility.longestLength / 12) * 100)}%` }} /></div>
          <div className="history-detail"><span>Longest available period</span><strong>{runLabel}</strong></div>
          {gapsExist && <p className="gap-note"><Info size={16} /> We found data in {eligibility.presentMonths.length} months, but there is no complete 12-month sequence yet. Import the missing months to unlock analysis.</p>}
          {!gapsExist && <p>Import <strong>{eligibility.monthsNeeded} more consecutive {eligibility.monthsNeeded === 1 ? 'month' : 'months'}</strong> to unlock rankings for the whole year.</p>}
        </> : <p>Import transaction history for 12 consecutive months to unlock your whole-year ranking.</p>}
        <div className="yearly-empty-actions">
          <button className="primary-button" onClick={onUpload}><FileUp size={17} /> Upload another statement</button>
          <button className="secondary-button" onClick={onMonthly}><CalendarRange size={16} /> View monthly</button>
          <button className="secondary-button" onClick={onDaily}><ReceiptText size={16} /> View daily</button>
        </div>
      </section>
    </main>
  );
}

export default function YearlyAnalysis({ transactions, onBack, onUpload, onMonthly, onDaily, onOpenGroup }) {
  const eligibility = useMemo(() => getYearlyEligibility(transactions), [transactions]);
  const [periodId, setPeriodId] = useState('');

  useEffect(() => {
    const stillAvailable = eligibility.periods.some((period) => period.id === periodId);
    if (!stillAvailable) setPeriodId(eligibility.periods[0]?.id || '');
  }, [eligibility.periods, periodId]);

  if (!eligibility.eligible) {
    return <YearlyUnavailable eligibility={eligibility} onBack={onBack} onUpload={onUpload} onMonthly={onMonthly} onDaily={onDaily} />;
  }

  const selectedPeriod = eligibility.periods.find((period) => period.id === periodId) || eligibility.periods[0];
  const periodTransactions = transactionsForYearlyPeriod(transactions, selectedPeriod);
  const counterpartyRows = rankYearlyCounterparties(periodTransactions);
  const totals = yearlyTotals(periodTransactions);

  return (
    <main className="yearly-page shell">
      <button className="back-button" onClick={onBack}><ArrowLeft size={17} />Back to overview</button>
      <header className="yearly-heading">
        <div>
          <div className="eyebrow"><BarChart3 size={15} /> Whole-year activity</div>
          <h1>Yearly analysis</h1>
          <p>Exact PhonePe names ranked by all money sent and received activity.</p>
        </div>
        <label className="period-select-label">
          <span>Analysis period</span>
          <div className="period-select-wrap"><select value={selectedPeriod.id} onChange={(event) => setPeriodId(event.target.value)}>{eligibility.periods.map((period) => <PeriodOption period={period} key={period.id} />)}</select><ChevronDown size={17} /></div>
        </label>
      </header>

      <section className="yearly-period-banner">
        <span><CalendarRange size={18} /></span>
        <div><strong>{selectedPeriod.label}</strong><small>{formatAnalysisMonth(selectedPeriod.startMonth)} to {formatAnalysisMonth(selectedPeriod.endMonth)} · {selectedPeriod.kind}</small></div>
      </section>

      <section className="yearly-summary-grid">
        <article><span className="year-stat-icon violet"><ReceiptText size={19} /></span><div><small>All activity</small><strong>{totals.count.toLocaleString('en-IN')}</strong><em>transactions</em></div></article>
        <article><span className="year-stat-icon peach"><ArrowUpRight size={19} /></span><div><small>Total paid</small><strong>{money(totals.paid)}</strong><em>outgoing payments</em></div></article>
        <article><span className="year-stat-icon mint"><ArrowDownLeft size={19} /></span><div><small>Total received</small><strong>{money(totals.received)}</strong><em>credits & transfers in</em></div></article>
        <article><span className="year-stat-icon sky"><UsersRound size={19} /></span><div><small>People & shops</small><strong>{counterpartyRows.length.toLocaleString('en-IN')}</strong><em>exact names</em></div></article>
      </section>

      <section className="yearly-ranking">
        <div className="yearly-ranking-heading"><div><h2>Most frequent people & shops</h2><p>Ranked by transaction count. Paid and received are kept separate.</p></div><span className="ranking-rule"><ShieldCheck size={15} /> Exact names only</span></div>
        <div className="yearly-table-head"><span>Rank</span><span>Person or shop</span><span>Transactions</span><span>Paid</span><span>Received</span><span /></div>
        <div className="yearly-rows">
          {counterpartyRows.map((group) => (
            <article className="yearly-row" key={group.key}>
              <span className={`rank-number ${group.rank <= 3 ? `top-${group.rank}` : ''}`}>#{group.rank}</span>
              <div className="yearly-counterparty"><span className="avatar">{group.name.charAt(0).toUpperCase()}</span><div><strong>{group.name}</strong><small>{group.count === 1 ? '1 transaction' : `${group.count} transactions`} in this period</small></div></div>
              <strong className="yearly-count">{group.count}</strong>
              <span className="yearly-paid">{group.paid ? money(group.paid) : '—'}</span>
              <span className="yearly-received">{group.received ? money(group.received) : '—'}</span>
              <button className="yearly-open" onClick={() => onOpenGroup(group.transactions)} aria-label={`View ${group.name} transactions`}><ArrowRight size={17} /></button>
            </article>
          ))}
        </div>
      </section>
      <p className="detail-footnote"><ShieldCheck size={16} /> This analysis uses only your imported records for the selected period. Similar-looking names are never merged.</p>
    </main>
  );
}
