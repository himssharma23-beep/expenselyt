const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildStructuredPdfHtml } = require('../utils/shared-pdf-html');

const { buildFriendTripPdfTables: web } = require('../utils/live-split-friend-pdf');
const mobilePath = path.resolve(__dirname, '../../ExpenseManager_mobile/src/screens/LiveSplitScreen.js');
const section = {
  title: 'Example Trip',
  trip: { members: [{ member_name: 'Saurav', target_user_id: 1 }, { member_name: 'Hims', target_user_id: 2 }, { member_name: 'Harpreet', target_user_id: 3 }] },
  events: [
    { date: '2026-06-10', details: 'dhaniya', payer: 'Saurav', total: 300, participants: [
      { name: 'Saurav', linked_user_id: 1, share: 100, paid: true },
      { name: 'Hims', linked_user_id: 2, share: 100, paid: false },
      { name: 'Harpreet', linked_user_id: 3, share: 100, paid: false },
    ] },
    { date: '2026-06-11', details: 'bandi', payer: 'Harpreet', total: 600, participants: [
      { name: 'Saurav', linked_user_id: 1, share: 200, paid: false },
      { name: 'Hims', linked_user_id: 2, share: 200, paid: false },
      { name: 'Harpreet', linked_user_id: 3, share: 200, paid: true },
    ] },
  ],
};
const focus = { name: 'Harpreet', linked_user_id: 3 };
const build = (builder, data = section, friend = focus) => JSON.parse(JSON.stringify(builder(data, friend, String, String)));

test('friend trip table matches the spreadsheet signs and column ordering', () => {
  const [table] = build(web);
  assert.deepEqual(table.columns, ['Date', 'Item', 'Paid By', 'Saurav', 'Hims', 'Harpreet', 'Total']);
  assert.deepEqual(table.rows[0].slice(3), ['+100', '-100', '-100', '300']);
  assert.deepEqual(table.rows[1].slice(3), ['-200', '-200', '+200', '600']);
  assert.deepEqual(table.boldColumnIndices, [5]);
  assert.deepEqual(table.headerRows[0][3], { content: 'Other Members', colSpan: 2 });
});

test('mobile and web create identical trip columns', { skip: !fs.existsSync(mobilePath) }, () => {
  for (const file of [mobilePath, path.join(__dirname, '../public/js/live-split.js')]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /["']live-split-friend["']/);
    assert.doesNotMatch(source, /function buildFriendTripPdfTables/);
  }
});

test('renamed friend is matched by account identity and remains immediately before Total', () => {
  const [table] = build(web, section, { name: 'Harpreet Singh', linked_user_id: 3 });
  assert.equal(table.columns.at(-2), 'Harpreet Singh');
  assert.equal(table.rows[0].at(-2), '-100');
  assert.equal(table.rows[1].at(-2), '+200');
});

test('mixed linked and name-only entries show the friend only in My Split on web and mobile', () => {
  const data = structuredClone(section);
  delete data.events[1].participants[2].linked_user_id;
  data.events[1].participants[2].name = '  HARPREET  ';
  const builders = [web];
  builders.forEach((builder) => {
    const [table] = build(builder, data);
    assert.deepEqual(table.columns, ['Date', 'Item', 'Paid By', 'Saurav', 'Hims', 'Harpreet', 'Total']);
    assert.equal(table.rows[0].at(-2), '-100');
    assert.equal(table.rows[1].at(-2), '+200');
    assert.deepEqual(table.rows[1].slice(3), ['-200', '-200', '+200', '600']);
  });
});

test('name-only entries resolve to a linked friend even when no event contains the account ID', () => {
  const data = structuredClone(section);
  data.events.forEach((event) => delete event.participants[2].linked_user_id);
  const [table] = build(web, data);
  assert.equal(table.columns.filter((name) => name === 'Harpreet').length, 1);
  assert.equal(table.rows[0].at(-2), '-100');
});

test('separate accounts with the same name are not merged', () => {
  const data = structuredClone(section);
  data.events[0].participants[0].name = 'Harpreet';
  const [table] = build(web, data);
  assert.equal(table.rows[0][3], '+100');
  assert.equal(table.rows[0].at(-2), '-100');
});

test('large trips continue across tables with the focus and totals repeated', () => {
  const data = structuredClone(section);
  for (let id = 4; id <= 10; id++) data.trip.members.push({ member_name: `Member ${id}`, target_user_id: id });
  const tables = build(web, data);
  assert.equal(tables.length, 3);
  tables.forEach((table) => {
    assert.ok(table.columns.length <= 9);
    assert.equal(table.columns.at(-2), 'Harpreet');
    assert.equal(table.rows[0].at(-2), '-100');
    assert.equal(table.rows[0].at(-1), '300');
  });
});

test('shared mobile PDF renders grouped headers, bold focus values, and landscape pages', () => {
  const html = buildStructuredPdfHtml({ title: 'Trip', landscape: true, tables: build(web) });
  assert.match(html, /colspan="2" rowspan="1">Other Members/);
  assert.match(html, /font-weight:700;text-align:right;[^>]*>\s*-100/);
  assert.match(html, /size: A4 landscape/);
  assert.doesNotMatch(html, /Each Split/);
});
