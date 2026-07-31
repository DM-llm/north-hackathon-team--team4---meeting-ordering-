import express from 'express';

export function createRulesRouter({ db, listRules, createRule, updateRule, deleteRule, latestRuleForTarget }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ ok: true, data: listRules(db) });
  });

  router.post('/', (req, res, next) => {
    try {
      const result = createRule(db, req.body, req.actor);
      res.status(201).json({ ok: true, data: result.data, reply: result.reply });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:ruleId', (req, res, next) => {
    try {
      const result = updateRule(db, req.params.ruleId, req.body, req.actor);
      res.json({ ok: true, data: result.data, reply: result.reply });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:ruleId', (req, res, next) => {
    try {
      const result = deleteRule(db, req.params.ruleId, req.actor);
      res.json({ ok: true, data: result.data, reply: result.reply });
    } catch (error) {
      next(error);
    }
  });

  router.get('/target/:roomId/latest', (req, res) => {
    res.json({ ok: true, data: latestRuleForTarget(db, req.params.roomId) });
  });

  return router;
}
