import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { createAuditLog, openDatabase, seedDatabase } from './db/index.js';
import { handleAgentMessage } from './services/agent.js';
import {
  cancelReservation,
  createReservation,
  createRoom,
  createRule,
  deleteRule,
  getAvailability,
  getFloorPlan,
  listAuditLogs,
  listCombinedSpaces,
  listReservations,
  listRooms,
  listRules,
  latestRuleForTarget,
  updateReservation,
  updateRoom,
  updateRule,
} from './services/business.js';

const shouldSeed = process.argv.includes('--seed');
const app = express();
const db = openDatabase();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

if (shouldSeed) {
  seedDatabase(db);
  console.log('Demo 数据已初始化。');
  db.close();
  process.exit(0);
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'meeting-ordering-api', runtime: 'nac-cloud-agent', model: config.model });
});

app.get('/api/me', (req, res) => {
  const actor = actorFromRequest(req);
  res.json({ ok: true, data: actor });
});

app.get('/api/rooms', (req, res) => {
  const rooms = listRooms(db, { date: req.query.date, time: req.query.time || req.query.start, includeCombinedSpaces: true });
  res.json({ ok: true, data: rooms });
});

app.get('/api/rooms/availability', (req, res) => {
  const result = getAvailability(db, req.query);
  res.json({ ok: true, data: result });
});

app.get('/api/rooms/floor-plan', (req, res) => {
  const result = getFloorPlan(db, { date: req.query.date, time: req.query.time });
  res.json({ ok: true, data: result });
});

app.post('/api/rooms', (req, res, next) => {
  try {
    const result = createRoom(db, req.body, actorFromRequest(req));
    res.status(201).json({ ok: true, data: result.data, reply: result.reply });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/rooms/:roomId', (req, res, next) => {
  try {
    const result = updateRoom(db, req.params.roomId, req.body, actorFromRequest(req));
    res.json({ ok: true, data: result.data, reply: result.reply });
  } catch (error) {
    next(error);
  }
});

app.get('/api/combined-spaces', (req, res) => {
  res.json({ ok: true, data: listCombinedSpaces(db) });
});

app.get('/api/rules', (req, res) => {
  res.json({ ok: true, data: listRules(db) });
});

app.get('/api/rules/target/:roomId/latest', (req, res) => {
  res.json({ ok: true, data: latestRuleForTarget(db, req.params.roomId) || null });
});

app.post('/api/rules', (req, res, next) => {
  try {
    const result = createRule(db, req.body, actorFromRequest(req));
    res.status(201).json({ ok: true, data: result.data, reply: result.reply });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/rules/:ruleId', (req, res, next) => {
  try {
    const result = updateRule(db, req.params.ruleId, req.body, actorFromRequest(req));
    res.json({ ok: true, data: result.data, reply: result.reply });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/rules/:ruleId', (req, res, next) => {
  try {
    const result = deleteRule(db, req.params.ruleId, actorFromRequest(req));
    res.json({ ok: true, data: result.data, reply: result.reply });
  } catch (error) {
    next(error);
  }
});

app.get('/api/reservations', (req, res) => {
  res.json({ ok: true, data: listReservations(db, { includeCancelled: false }) });
});

app.post('/api/reservations', (req, res, next) => {
  try {
    const result = createReservation(db, req.body, actorFromRequest(req));
    res.status(201).json({ ok: true, data: result.data, reply: result.reply });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/reservations/:reservationId', (req, res, next) => {
  try {
    const result = updateReservation(db, req.params.reservationId, req.body, actorFromRequest(req));
    res.json({ ok: true, data: result.data, reply: result.reply });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/reservations/:reservationId', (req, res, next) => {
  try {
    const result = cancelReservation(db, req.params.reservationId, actorFromRequest(req));
    res.json({ ok: true, data: result.data, reply: result.reply });
  } catch (error) {
    next(error);
  }
});

app.post('/api/agent/message', async (req, res, next) => {
  try {
    const result = await handleAgentMessage({ db, input: req.body, actor: actorFromRequest(req) });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/audit-log', (req, res) => {
  res.json({ ok: true, data: listAuditLogs(db) });
});

app.post('/api/demo/reset', (req, res) => {
  seedDatabase(db);
  createAuditLog(db, {
    action: 'demo.reset.frontend',
    actor_id: actorFromRequest(req).actor_id,
    actor_role: actorFromRequest(req).actor_role,
    entity_type: 'database',
    entity_id: 'demo',
    before_json: null,
    after_json: JSON.stringify(req.body || {}),
    message: '前端触发 Demo 数据重置。',
  });
  res.json({ ok: true, data: { reset: true }, reply: 'Demo 数据已重置。' });
});

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  res.status(statusCode).json({
    ok: false,
    message: statusCode === 500 ? '服务器内部错误' : error.message,
    details: error.details,
  });
});

app.listen(config.port, () => {
  console.log(`Meeting ordering API listening on http://localhost:${config.port}`);
});

function actorFromRequest(req) {
  const role = req.body?.role || req.query?.role || req.headers['x-user-role'] || 'member';
  const isAdmin = role === 'admin';
  return {
    actor_id: req.body?.actor_id || req.body?.user_id || (isAdmin ? 'demo-admin' : 'demo-member'),
    actor_role: isAdmin ? 'admin' : 'member',
    role: isAdmin ? 'admin' : 'member',
  };
}
