function tripChecklistMemberOptions(trip) {
  return (trip.members || []).map(m => ({ key: m.linked_user_id ? `u:${Number(m.linked_user_id)}` : `g:${String(m.member_name).trim().toLowerCase()}`,
    name: m.member_name, user_id: Number(m.linked_user_id) || null }));
}
function matchTripChecklistMember(user, members) {
  const linked = members.filter(m => m.user_id === Number(user.linked_user_id || user.id));
  if (linked.length === 1) return linked[0].key;
  const normalize = name => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const names = [user.display_name, user.member_name, user.username].map(normalize).filter(Boolean);
  const exact = members.filter(m => names.includes(normalize(m.name)));
  if (exact.length === 1) return exact[0].key;
  if (exact.length > 1) return '';
  const first = members.filter(m => names.some(n => n.split(' ')[0] === normalize(m.name).split(' ')[0]));
  return first.length === 1 ? first[0].key : '';
}
if (typeof module !== 'undefined' && module.exports) module.exports = { tripChecklistMemberOptions, matchTripChecklistMember };
