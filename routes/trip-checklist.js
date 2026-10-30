const router = require('express').Router();
const checklist = require('../db/trip-checklist');
const handle = fn => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
};
router.get('/:id/checklist', handle(req => checklist.load(req.session.userId, req.params.id)));
router.post('/:id/checklist/items', handle(async req => {
  await checklist.editItem(req.session.userId, req.params.id, null, req.body); return { success: true };
}));
router.put('/:id/checklist/items/:iid', handle(async req => {
  await checklist.editItem(req.session.userId, req.params.id, req.params.iid, req.body); return { success: true };
}));
router.delete('/:id/checklist/items/:iid', handle(async req => {
  await checklist.editItem(req.session.userId, req.params.id, req.params.iid, null, true); return { success: true };
}));
router.put('/:id/checklist/items/:iid/check', handle(async req => {
  await checklist.check(req.session.userId, req.params.id, req.params.iid, req.body); return { success: true };
}));
router.put('/:id/checklist/reminder', handle(async req => {
  await checklist.saveReminder(req.session.userId, req.params.id, req.body); return { success: true };
}));
module.exports = router;
