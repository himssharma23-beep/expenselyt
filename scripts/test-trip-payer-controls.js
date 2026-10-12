const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

test('trip entries show participants and keep payer controls inside collapsed split settings', async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="modal"></main>');
    await page.evaluate(() => {
      const people = [{ key: 'self', name: 'You' }, { key: '2', name: 'Friend' }];
      const makeRow = key => ({ key, item_name: 'Meal', amount: 100, participant_keys: ['self', '2'], split_mode: 'equal', split_values: {}, selected: true });
      window.state = { tripCreate: { name: 'Trip', start_date: '2026-10-08', wizardStep: 3, selected: new Set(['2']), paid_by: 'You', finance_target: 'none', scan_items: [makeRow('scan-1')], manual_items: [makeRow('manual-1'), makeRow('manual-2')] }, friends: [{ id: 2, name: 'Friend' }], bankAccounts: [], creditCards: [] };
      window.n = value => Number(value || 0);
      window.r2 = value => Math.round(Number(value) * 100) / 100;
      window.escHtml = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      window.fmtCur = value => String(value);
      window.todayLocalIso = () => '2026-10-08';
      window.toLocalIsoDate = value => value || '2026-10-08';
      window.textKey = value => String(value).toLowerCase();
      window.toJsArg = JSON.stringify;
      window.hasLiveSplitVoiceDrafts = () => false;
      window.tripCreateSelectedFriends = () => state.friends;
      window.tripCreatePayerOptions = () => ['You', 'Friend'];
      window.computeTripCreateShareTotals = () => [];
      window.getTripScanSubtotalAll = () => 100;
      window.getTripScanReceiptTax = window.getTripScanReceiptTaxPct = window.getTripScanRowTaxShare = () => 0;
      window.getTripScanRowEffectiveAmount = (form, row) => Number(row.amount);
      window.computeTripRowSelfShare = () => 50;
      window.normalizeTripManualRowSplitState = window.normalizeTripScanRowSplitState = row => row;
      window.computeTripManualRowSplit = window.computeTripScanRowSplit = () => ({ valid: true, shares: people.map(person => ({ ...person, share: 50 })) });
      window.getTripScanParticipantOptions = window.getTripScanRowPeople = window.getTripManualRowPeople = () => people;
      window.openModal = (title, html) => { document.getElementById('modal').innerHTML = html; };
      window.liveSplitTripDefaultsOpen = () => {};
      window.liveSplitTripRowExpanded = () => {};
      window.liveSplitTripManualItem = (key, field, value) => { state.tripCreate.manual_items.find(row => row.key === key)[field] = value; };
      window.liveSplitTripScanItem = (key, field, value) => { state.tripCreate.scan_items.find(row => row.key === key)[field] = value; };
    });
    const source = fs.readFileSync(path.join(__dirname, '../public/js/live-split.js'), 'utf8');
    await page.addScriptTag({ content: source.slice(source.indexOf('  function renderTripCreateModal()'), source.indexOf('  async function saveLiveSplitTrip()')) });
    await page.evaluate(() => renderTripCreateModal());
    const controls = await page.$$eval('select[data-trip-manual-field="paid_by"],select[data-trip-scan-field="paid_by"]', elements => elements.map(element => ({ key: element.dataset.tripManualKey || element.dataset.tripScanKey, hidden: !!element.closest('details:not([open]),[hidden]'), options: [...element.options].map(option => option.value) })));
    assert.deepEqual(controls.map(item => item.key).sort(), ['manual-1', 'manual-2', 'scan-1']);
    assert.ok(controls.every(item => item.hidden));
    const participants = await page.$$eval('button[onclick*="ToggleParticipant"],input[onchange*="ToggleSelf"]', elements => elements.map(element => ({ hidden: !!element.closest('details:not([open]),[hidden]'), selected: element.type === 'checkbox' ? element.checked : element.classList.contains('active') })));
    assert.equal(participants.length, 6);
    assert.ok(participants.every(item => !item.hidden && item.selected));
    await page.$$eval('details.tw-row-split', elements => elements.forEach(element => { element.open = true; }));
    assert.ok(controls.every(item => item.options.includes('Friend')));
    await page.select('select[data-trip-manual-key="manual-1"]', 'Friend');
    await page.select('select[data-trip-scan-key="scan-1"]', 'Friend');
    await page.evaluate(() => renderTripCreateModal());
    assert.equal(await page.$eval('select[data-trip-manual-key="manual-1"]', element => element.value), 'Friend');
    assert.equal(await page.$eval('select[data-trip-scan-key="scan-1"]', element => element.value), 'Friend');
    assert.equal(await page.$eval('select[data-trip-manual-key="manual-2"]', element => element.value), '');
    // Exercise real row updates and focus restoration, without blur/change events.
    await page.evaluate(() => {
      document.body.innerHTML = '<div id="modalOverlay"><div id="modalContent"><div class="modal-body"></div></div></div>';
      window.openModal = (title, html) => { document.querySelector('.modal-body').innerHTML = html; };
      window.computeTripRowSelfShare = (form, row) => Number(row.amount) / 2;
    });
    await page.addScriptTag({ content: source.slice(source.indexOf('  function captureTripCreateModalUiState()'), source.indexOf('  function renderTripCreateModal()')) });
    await page.evaluate(() => {
      window.liveSplitTripManualItem = (key, field, value) => updateTripManualItemWeb(key, { [field]: value });
      window.liveSplitTripScanItem = (key, field, value) => updateTripScanItemWeb(key, { [field]: value });
      renderTripCreateModal();
    });
    for (const kind of ['manual', 'scan']) {
      const selector = `[data-trip-${kind}-key="${kind}-1"][data-trip-${kind}-field="amount"]`;
      await page.focus(selector);
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.evaluate(() => { window.typingInput = document.activeElement; });
      let typed = '';
      for (const character of '454.5') {
        typed += character;
        await page.keyboard.type(character);
        const actual = await page.evaluate(kind => {
          const row = state.tripCreate[`${kind}_items`][0];
          const input = document.activeElement;
          const card = input.closest('[style*="border:1px"]');
          return { amount: Number(row.amount), sameInput: input === window.typingInput, card: card?.textContent, totals: document.querySelector('.tw-totals').textContent };
        }, kind);
        assert.equal(actual.amount, Number(typed));
        assert.equal(actual.sameInput, true, 'typing retains the active input');
        assert.ok(actual.card.includes(String(Number(typed))), 'amount badge refreshes immediately');
        const expectedTotal = Number(typed) + (kind === 'manual' ? 200 : 554.5);
        assert.ok(actual.totals.includes(String(expectedTotal)), 'trip total refreshes immediately');
      }
      const nameSelector = `[data-trip-${kind}-key="${kind}-1"][data-trip-${kind}-field="item_name"]`;
      await page.focus(nameSelector);
      await page.keyboard.press('Home');
      await page.keyboard.type('New ');
      assert.equal(await page.evaluate(kind => state.tripCreate[`${kind}_items`][0].item_name, kind), 'New Meal');
    }
  } finally { await browser.close(); }
});

test('mobile new rows select everyone while participants remain visible', () => {
  const root = path.resolve(__dirname, '../../ExpenseManager_mobile');
  const source = fs.readFileSync(path.join(root, 'src/screens/LiveSplitScreen.js'), 'utf8');
  const ast = require(path.join(root, 'node_modules/@babel/parser')).parse(source, {sourceType:'module',plugins:['jsx']});
  const functions = new Map();
  function walk(node, callback, ancestors = []) {
    if (!node || typeof node !== 'object') return;
    callback(node, ancestors);
    for (const [key, child] of Object.entries(node)) {
      if (['loc','start','end'].includes(key)) continue;
      if (Array.isArray(child)) child.forEach(value => walk(value, callback, [...ancestors,node]));
      else if (child && typeof child === 'object') walk(child, callback, [...ancestors,node]);
    }
  }
  walk(ast, node => { if(node.type === 'FunctionDeclaration') functions.set(node.id.name,node); });
  const vm = require('node:vm');
  const context = vm.createContext({selectedTripFriends:[{id:2},{id:3}], tripBulkDate:'2026-10-12', tripStartDate:'', todayISO:()=> '2026-10-12', toLocalIsoDate:value=>value, rows:[{selected_keys:['self']}]});
  vm.runInContext('function setTripManualItems(update) { rows = update(rows); }',context);
  for(const name of ['createTripCreateRow','addTripManualItem']) {
    const node=functions.get(name);
    vm.runInContext(source.slice(node.start,node.end),context);
  }
  vm.runInContext('addTripManualItem()',context);
  assert.deepEqual(Array.from(context.rows[1].selected_keys),['self','2','3']);
  assert.deepEqual(Array.from(context.rows[0].selected_keys),['self']);
  const labels=[];
  walk(functions.get('renderTripCreateRowEditor'), (node, ancestors)=> {
    if(node.type === 'JSXText' && ['Participants','Include me in this item','Paid by','Split Mode'].includes(node.value.trim())) {
      labels.push([node.value.trim(),ancestors.some(parent=>parent.type==='LogicalExpression' && source.slice(parent.left.start,parent.left.end).includes('tripExpandedRows.has'))]);
    }
  });
  assert.deepEqual(labels,[['Participants',false],['Include me in this item',false],['Paid by',true],['Split Mode',true]]);
});
