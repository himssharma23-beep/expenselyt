  function buildFriendTripPdfTables(section, focus, money, dateLabel) {
    const key = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const people = new Map();
    const rawIdentity = (person) => Number(person.linked_user_id || person.target_user_id || 0) > 0
      ? `u:${Number(person.linked_user_id || person.target_user_id)}` : `n:${key(person.name || person.member_name)}`;
    // Older entries can identify the same member by name while newer ones use an account ID.
    const accountsByName = new Map();
    const knownPeople = [focus, ...(section.trip?.members || []),
      ...(section.events || []).flatMap((event) => event.participants || [])];
    knownPeople.forEach((person) => {
      if (!person) return;
      const id = rawIdentity(person);
      const name = key(person.name || person.member_name);
      if (!name || !id.startsWith('u:')) return;
      if (!accountsByName.has(name)) accountsByName.set(name, new Set());
      accountsByName.get(name).add(id);
    });
    const identity = (person) => {
      const id = rawIdentity(person);
      if (id.startsWith('u:')) return id;
      const accounts = accountsByName.get(key(person.name || person.member_name));
      // Do not merge separate registered people who happen to share a name.
      return accounts?.size === 1 ? [...accounts][0] : id;
    };
    const addPerson = (person) => {
      const name = String(person.name || person.member_name || '').trim();
      if (!name) return;
      const id = identity(person);
      if (!people.has(id)) people.set(id, { ...person, name, id });
    };
    const events = section.events || [];
    events.forEach((event) => (event.participants || []).forEach(addPerson));
    (section.trip?.members || []).forEach((member) => {
      if (people.has(identity(member))) return;
      const name = member.member_name || member.name || '';
      if (key(name) !== 'you' && ![...people.values()].some((person) => key(person.name) === key(name))) addPerson({ ...member, name });
    });
    const focusId = Number(focus?.linked_user_id || 0) > 0 ? `u:${Number(focus.linked_user_id)}` : null;
    let focused = focusId ? people.get(focusId) : null;
    if (!focused) focused = [...people.values()].find((person) => key(person.name) === key(focus?.name));
    if (!focused) focused = { id: focusId || `n:${key(focus?.name)}`, name: focus?.name || 'Friend' };
    const others = [...people.values()].filter((person) => person.id !== focused.id);
    const batches = [];
    for (let offset = 0; offset < Math.max(1, others.length); offset += 4) {
      const members = [...others.slice(offset, offset + 4), focused];
      const otherCount = members.length - 1;
      const focusColumn = 3 + otherCount;
      const headerRows = [[
        { content: 'Date', rowSpan: 2 }, { content: 'Item', rowSpan: 2 }, { content: 'Paid By', rowSpan: 2 },
        ...(otherCount ? [{ content: 'Other Members', colSpan: otherCount }] : []),
        { content: 'My Split' }, { content: 'Total', rowSpan: 2 },
      ], members.map((person) => ({ content: person.id === focused.id ? (focus?.name || person.name) : person.name }))];
      batches.push({
        title: `Trip Details - ${section.title || 'Trip'}${offset ? ' (continued)' : ''}`,
        columns: ['Date', 'Item', 'Paid By', ...members.map((person) => person.id === focused.id ? (focus?.name || person.name) : person.name), 'Total'],
        headerRows, boldColumnIndices: [focusColumn], amountColumnIndex: focusColumn + 1,
        rows: events.map((event) => [
          dateLabel(event.date), event.details || '-', event.payer || '-',
          ...members.map((person) => {
            const participants = (event.participants || []).filter((item) => identity(item) === person.id
              || (person.id.startsWith('n:') && identity(item).startsWith('n:') && key(item.name) === key(person.name)));
            if (!participants.length) return '-';
            const amount = Math.round(participants.reduce((sum, item) => sum + (item.paid ? 1 : -1) * Number(item.share || 0), 0) * 100) / 100;
            return `${amount > 0 ? '+' : amount < 0 ? '-' : ''}${money(Math.abs(amount))}`;
          }), money(event.total || 0),
        ]),
      });
    }
    return batches;
  }


function buildLiveSplitFriendPdfPayload({ row = {}, scoped = {}, fromDate = '', toDate = '', currency = 'INR' } = {}) {
  const amount = value => Math.round((Number(value) || 0) * 100) / 100;
  const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(value);
  const date = value => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(match[2]) - 1]} ${match[1]}` : '-';
  };
  const signed = value => `${amount(value) > 0.005 ? '+' : amount(value) < -0.005 ? '-' : ''}${money(Math.abs(amount(value)))}`;
  const events = scoped.filteredEvents || [];
  const trips = scoped.tripSections || [];
  const overall = amount(row.amount);
  const range = amount(events.reduce((sum, event) => sum + amount(event.delta), 0));
  const card = (prefix, value) => ({
    label: `${prefix} ${value > 0.005 ? 'to receive' : value < -0.005 ? 'to pay' : 'settled'}`,
    value: money(Math.abs(value)),
  });
  return {
    title: `Live Split - ${row.name || 'Friend'}`,
    subtitle: `${date(fromDate)} - ${date(toDate)}`,
    breadcrumb: `${events.length} entries`, landscape: true,
    totals: { cards: [card('Overall', overall), { label: 'Entries', value: String(events.length) }, card('Selected range', range), { label: 'Trips', value: String(trips.length) }] },
    tables: [{
      title: 'Live Split Entries', columns: ['Date', 'Details', 'Type', 'Paid By', 'Amount'], amountColumnIndex: 4, boldColumnIndices: [4],
      rows: events.map(event => [date(event.date), event.details || '-', event.type === 'trip_summary' ? 'Trip' : 'Split', event.payer || '-', signed(event.delta)]),
    }, ...trips.flatMap(section => buildFriendTripPdfTables(section, row, money, date).map(table => ({ ...table, subtitle: `Net in range: ${signed(section.delta)}` })))],
  };
}

module.exports = { buildLiveSplitFriendPdfPayload, buildFriendTripPdfTables };
