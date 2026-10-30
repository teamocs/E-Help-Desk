import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BarTable, Columns } from './charts';
import { DataTable, ReportsScreen } from './Reports';
import reports from './index';
import {
  REPORTS, bars, change, connection, daysIn, describe as describeSeries, downloadCsv, fetchReport, fileName, fmt, niceMax, nextSort, presetOf, presetRange,
  queryOf, rangeLabel, rangeProblem, sortRows, spoken, type Conn, type Query,
} from './model';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
// 2026-10-30 23:30 UTC is 07:30 on Oct 31 in Manila: the UTC date is still the 30th.
const early = Date.parse('2026-10-30T23:30:00Z');
const conn: Conn = { restUrl: 'https://h.test/wp-json/azl-ehd/v1/', nonce: 'n1', actor: () => null, hotel: 'Azalea Baguio' };
const q: Query = { from: '2026-10-01', to: '2026-10-31', filters: { dept: 'engineering', type: '' } };

describe('the six reports', () => {
  it('are the prototype tiles in its order, and the module keeps its sidebar id and label', () => {
    expect(REPORTS.map((r) => r.title)).toEqual(['Response Time', 'KPI Dashboard', 'Room Turnaround', 'WO Summary', 'Inquiry Volume', 'Crisis Log']);
    expect(reports).toMatchObject({ id: 'reports', label: 'Reports', icon: 'chart' });
    expect(reports.badge).toBeUndefined();
  });
});

describe('date range: hotel days in Manila', () => {
  it('presets end today in the hotel, not the UTC date', () => {
    expect(presetRange('today', early)).toEqual({ from: '2026-10-31', to: '2026-10-31' });
    expect(presetRange('7', early)).toEqual({ from: '2026-10-25', to: '2026-10-31' });
    expect(presetRange('30', early)).toEqual({ from: '2026-10-02', to: '2026-10-31' });
    expect(presetRange('month', early)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('month', Date.parse('2026-10-31T16:30:00Z'))).toEqual({ from: '2026-11-01', to: '2026-11-01' });
  });
  it('knows which preset a range is, else custom', () => {
    expect(presetOf({ from: '2026-10-25', to: '2026-10-31' }, early)).toBe('7');
    expect(presetOf({ from: '2026-10-24', to: '2026-10-31' }, early)).toBe('custom');
  });
  it('counts days and refuses what the server refuses', () => {
    expect(daysIn({ from: '2026-10-01', to: '2026-10-31' })).toBe(31);
    expect(rangeProblem({ from: '2026-10-01', to: '2026-10-31' })).toBeNull();
    expect(rangeProblem({ from: '2026-11-01', to: '2026-10-31' })).toBe('The start date is after the end date.');
    expect(rangeProblem({ from: '', to: '2026-10-31' })).toBe('Choose both dates.');
    expect(rangeProblem({ from: '2026-02-30', to: '2026-03-01' })).toBe('Choose both dates.');
    expect(rangeProblem({ from: '2025-10-30', to: '2026-10-30' })).toBeNull(); // 366 days
    expect(rangeProblem({ from: '2025-10-29', to: '2026-10-30' })).toBe('Choose at most 366 days.');
  });
  it('reads a range in words', () => {
    expect(rangeLabel({ from: '2026-10-01', to: '2026-10-30' })).toBe('Oct 1 to 30, 2026');
    expect(rangeLabel({ from: '2026-09-28', to: '2026-10-04' })).toBe('Sep 28 to Oct 4, 2026');
    expect(rangeLabel({ from: '2025-12-30', to: '2026-01-02' })).toBe('Dec 30, 2025 to Jan 2, 2026');
    expect(rangeLabel({ from: '2026-10-30', to: '2026-10-30' })).toBe('Oct 30, 2026');
  });
});

describe('formatting: every number with its unit', () => {
  it('formats each unit, and a dash for nothing', () => {
    expect(fmt(67, 'pct')).toBe('67%');
    expect(fmt(1.84, 'min')).toBe('1.8 min');
    expect(fmt(150, 'min')).toBe('2 h 30 min');
    expect(fmt(114.6, 'min')).toBe('1 h 55 min');
    expect(fmt(120, 'min')).toBe('2 h');
    expect(spoken(114.6, 'min')).toBe('1 hour 55 minutes');
    expect(fmt(4, 'h')).toBe('4 h');
    expect(fmt(72, 'h')).toBe('3 days');
    expect(fmt(1250.5, 'php')).toBe('₱1,250.50');
    expect(fmt(12345, 'count')).toBe('12,345');
    expect(fmt('2026-10-05', 'date')).toBe('Oct 5');
    expect(fmt(Date.parse('2026-10-30T16:30:00Z'), 'time')).toBe('Oct 31, 12:30 AM');
    expect(fmt(null, 'pct')).toBe('–');
    expect(spoken(67, 'pct')).toBe('67 percent');
    expect(spoken(1.5, 'min')).toBe('1.5 minutes');
    expect(spoken(null, 'min')).toBe('no data');
  });
  it('says the change against the previous period in points, minutes or counts with a share', () => {
    expect(change(82, 75, 'pct')).toEqual({ text: '+7 pts', dir: 'up' });
    expect(change(3.2, 4.4, 'min')).toEqual({ text: '−1.2 min', dir: 'down' });
    expect(change(120, 100, 'count')).toEqual({ text: '+20 (20%)', dir: 'up' });
    expect(change(5, 0, 'count')).toEqual({ text: '+5', dir: 'up' });
    expect(change(5, 5, 'count')).toEqual({ text: 'no change', dir: 'same' });
    expect(change(null, 5, 'count')).toBeNull();
  });
});

describe('tables and charts', () => {
  const rows = [{ t: 'b', n: 2 }, { t: 'a', n: null }, { t: 'c', n: 10 }];
  it('sorts by a column with empty cells last, numbers first descending', () => {
    expect(sortRows(rows, { key: 'n', dir: 'desc' }).map((r) => r.t)).toEqual(['c', 'b', 'a']);
    expect(sortRows(rows, { key: 'n', dir: 'asc' }).map((r) => r.t)).toEqual(['b', 'c', 'a']);
    expect(sortRows(rows, { key: 't', dir: 'asc' }).map((r) => r.t)).toEqual(['a', 'b', 'c']);
    expect(nextSort(null, 'n', true)).toEqual({ key: 'n', dir: 'desc' });
    expect(nextSort({ key: 'n', dir: 'desc' }, 'n', true)).toEqual({ key: 'n', dir: 'asc' });
    expect(nextSort({ key: 'n', dir: 'desc' }, 't', false)).toEqual({ key: 't', dir: 'asc' });
  });
  it('scales bars to a round top and describes a series in one sentence', () => {
    expect([0, 7, 23, 140, 1].map(niceMax)).toEqual([1, 8, 25, 150, 1]);
    const b = bars([{ label: 'Mon', value: 3 }, { label: 'Tue', value: 6 }, { label: 'Wed', value: null }]);
    expect(b.top).toBe(6);
    expect(b.bars.map((x) => x.share)).toEqual([0.5, 1, 0]);
    expect(bars([{ label: 'x', value: 150 }], 100).bars[0].share).toBe(1);
    expect(describeSeries([{ label: 'Oct 1', value: 3 }, { label: 'Oct 2', value: 9 }], 'items')).toBe('12 items in total; the most, 9, on Oct 2.');
    expect(describeSeries([], 'items')).toBe('No items in these dates.');
  });
  it('a bar chart is a table for screen readers and a column chart has a description and its numbers', () => {
    const html = renderToStaticMarkup(<BarTable title="By department" series={[{ name: 'Relayed within 2 min', unit: 'pct' }, { name: 'Completed within target', unit: 'pct', tone: 'gold' }]} top={100} rows={[{ label: 'Housekeeping', values: [80, null] }]} />);
    expect(html).toContain('role="table"');
    expect(html).toContain('role="rowheader" class="rp-blabel">Housekeeping');
    expect(html).toContain('aria-label="Relayed within 2 min: 80 percent"');
    expect(html).toContain('aria-label="Completed within target: no data"');
    expect(html).toContain('width:80%');
    const cols = renderToStaticMarkup(<Columns title="Items logged per day" noun="items" points={[{ label: 'Oct 1', value: 4 }, { label: 'Oct 2', value: 2 }]} />);
    expect(cols).toContain('role="img" aria-label="Items logged per day. 6 items in total; the most, 4, on Oct 1."');
    expect(text(cols)).toContain('Show the numbers');
    expect(text(cols)).toContain('Oct 2 2');
  });
  it('the data table sorts by headings with aria-sort and formats every cell with its unit', () => {
    const html = renderToStaticMarkup(<DataTable caption="WO Summary" phone table={{ columns: [{ key: 'no', label: 'WO', unit: '' }, { key: 'hours', label: 'Time to complete', unit: 'h' }, { key: 'est', label: 'Estimated cost', unit: 'php' }, { key: 'pct', label: 'Share', unit: 'pct' }], rows: [{ no: 'WO-0001', hours: 4, est: 1000, pct: 50 }] }} />);
    expect(html).toContain('aria-sort="none"');
    expect(text(html)).toContain('Estimated cost (₱)');
    expect(text(html)).toContain('WO-0001 4 h ₱1,000.00 50%');
    expect(text(html)).toContain('Swipe the table sideways to see every column.');
    expect(html).toContain('role="region"');
  });
});

describe('the landing page', () => {
  it('shows Today at a glance first, then the six tiles; outside WordPress it never fakes numbers', () => {
    const html = text(renderToStaticMarkup(<ReportsScreen />));
    expect(html.indexOf('Today at a glance')).toBeGreaterThan(-1);
    expect(html.indexOf('Today at a glance')).toBeLessThan(html.indexOf('Response Time'));
    for (const r of REPORTS) expect(html).toContain(r.title);
    expect(html).toContain('Counting…');
    expect(html).toContain('never a ranking of people');
  });
});

describe('the server calls', () => {
  it('reads window.AZL for the REST address, and is null outside WordPress', () => {
    expect(connection({})).toBeNull();
    const c = connection({ AZL: { restUrl: 'https://h.test/wp-json/azl-ehd/v1/', nonce: 'n9', user: { role: 'owner' }, property: { id: '1', name: 'Azalea Baguio' } } });
    expect(c).toMatchObject({ restUrl: 'https://h.test/wp-json/azl-ehd/v1/', nonce: 'n9', hotel: 'Azalea Baguio' });
  });
  it('sends the dates and only the filters that are set', () => {
    expect(queryOf(q)).toEqual({ from: '2026-10-01', to: '2026-10-31', dept: 'engineering' });
    expect(queryOf(q, 'csv')).toMatchObject({ format: 'csv' });
  });
  it('fetches a report with the nonce and the PIN token, and turns failures into sentences', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, report: 'kpi' }), { status: 200 }));
    const r = await fetchReport({ ...conn, actor: () => 'tok' }, 'kpi', q, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, data: { ok: true, report: 'kpi' } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://h.test/wp-json/azl-ehd/v1/reports/kpi?from=2026-10-01&to=2026-10-31&dept=engineering');
    expect(init.headers).toMatchObject({ 'X-WP-Nonce': 'n1', 'X-Azl-Actor': 'tok' });
    expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
    const bad = async (status: number, body: unknown) => fetchReport(conn, 'kpi', q, (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch);
    expect(await bad(400, { ok: false, error: 'Choose at most 366 days.' })).toEqual({ ok: false, error: 'Choose at most 366 days.' });
    expect((await bad(403, { code: 'rest_forbidden' })).ok).toBe(false);
    expect(await bad(500, {})).toEqual({ ok: false, error: 'The server could not make this report. Try again in a moment.' });
    expect(await fetchReport(conn, 'kpi', q, (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).toEqual({ ok: false, error: 'Could not reach the server. Check the connection and try again.' });
    expect((await fetchReport(null, 'kpi', q)).ok).toBe(false);
  });
  it('the CSV button fetches with the nonce, then saves the file under the server\'s name', async () => {
    const save = vi.fn();
    const f = vi.fn(async () => new Response('﻿a,b\r\n', { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="azalea-baguio-wo-summary-2026-10-01-to-2026-10-31.csv"' } }));
    const r = await downloadCsv(conn, 'workorders', q, f as unknown as typeof fetch, save);
    expect(r).toEqual({ ok: true, data: 'azalea-baguio-wo-summary-2026-10-01-to-2026-10-31.csv' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/reports/workorders?from=2026-10-01&to=2026-10-31&dept=engineering&format=csv');
    expect(init.headers).toMatchObject({ 'X-WP-Nonce': 'n1', Accept: 'text/csv' });
    const [blob, name] = save.mock.calls[0] as [Blob, string];
    expect(name).toBe('azalea-baguio-wo-summary-2026-10-01-to-2026-10-31.csv');
    expect(new Uint8Array(await blob.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    const refused = await downloadCsv(conn, 'workorders', q, (async () => new Response('{"ok":false,"error":"Unknown format."}', { status: 400 })) as unknown as typeof fetch, save);
    expect(refused).toEqual({ ok: false, error: 'Unknown format.' });
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('keeps a file name safe, with a fallback', () => {
    expect(fileName('attachment; filename="../x/evil name.csv"', 'kpi', q)).toBe('..-x-evil-name.csv');
    expect(fileName(null, 'kpi', q)).toBe('kpi-2026-10-01-to-2026-10-31.csv');
    expect(fileName('attachment; filename="x.exe"', 'kpi', q)).toBe('kpi-2026-10-01-to-2026-10-31.csv');
  });
});
