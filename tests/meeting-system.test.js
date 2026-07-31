import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, seedDatabase } from '../apps/api/src/db/index.js';
import { createReservation, createRule, getAvailability, listRooms, listRules, updateRule } from '../apps/api/src/services/business.js';
import { handleAgentMessage } from '../apps/api/src/services/agent.js';

process.env.DATABASE_URL = `file:${path.join(os.tmpdir(), `meeting-ordering-test-${Date.now()}-${Math.random()}.sqlite3`)}`;
process.env.OPENAI_API_KEY = '';
process.env.ALLOW_LOCAL_AGENT_FALLBACK = 'true';

const actor = { actor_id: 'demo-member', actor_role: 'member', role: 'member' };
const admin = { actor_id: 'demo-admin', actor_role: 'admin', role: 'admin' };

test.after(() => {
  const dbPath = process.env.DATABASE_URL.replace(/^file:/, '');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

test('seed creates only contest default rooms', () => {
  const db = openDatabase();
  seedDatabase(db);
  const rooms = listRooms(db);
  assert.deepEqual(rooms.map((room) => room.id).sort(), ['room503', 'room505', 'room506', 'activity', 'room1', 'room2'].sort());
});

test('activity lunch rule blocks noon meetings', () => {
  const db = openDatabase();
  seedDatabase(db);
  assert.throws(() => createReservation(db, {
    space_id: 'activity',
    date: '2026-08-03',
    start_time: '12:00',
    end_time: '13:00',
    title: '午餐会议',
    organizer_id: actor.actor_id,
  }, actor), /午餐/);
});

test('room505 is unavailable on Tuesdays', () => {
  const db = openDatabase();
  seedDatabase(db);
  const result = getAvailability(db, { date: '2026-08-04', start_time: '10:00', end_time: '11:00', filters: { room_type: 'small' } });
  assert.equal(result.available.some((item) => item.id === '505'), false);
  assert.equal(result.unavailable.some((item) => item.space_id === '505'), true);
});

test('combined room reservation blocks room1 and room2 separately', () => {
  const db = openDatabase();
  seedDatabase(db);
  createReservation(db, {
    space_id: 'combined-room1-room2',
    date: '2026-08-07',
    start_time: '14:00',
    end_time: '16:00',
    title: '大会议',
    organizer_id: admin.actor_id,
  }, admin);
  assert.throws(() => createReservation(db, {
    space_id: 'room1',
    date: '2026-08-07',
    start_time: '14:30',
    end_time: '15:30',
    title: '拆分预约',
    organizer_id: actor.actor_id,
  }, actor), /合并/);
});

test('temporary rule update rewrites the same rule record', () => {
  const db = openDatabase();
  seedDatabase(db);
  createRule(db, {
    type: 'temporary_unavailable',
    target_room_id: '504',
    date: '2026-08-05',
    start_time: '00:00',
    end_time: '23:59',
    recurrence: 'none',
    reason: '临时维修',
    source: 'agent',
  }, admin);
  const firstRules = listRules(db);
  const firstRule = firstRules.find((rule) => rule.target_room_id === '504');
  assert.equal(firstRule.version, 1);
  updateRule(db, firstRule.id, {
    start_time: '12:00',
    end_time: '23:59',
    reason: '只停用下午',
  }, admin);
  const updatedRules = listRules(db);
  assert.equal(updatedRules.length, firstRules.length);
  assert.equal(updatedRules.find((rule) => rule.target_room_id === '504').version, 2);
});

test('agent local fallback creates structured query and rule updates', async () => {
  const db = openDatabase();
  seedDatabase(db);
  const query = await handleAgentMessage({ db, input: { message: '下周二 10:00-11:00 想约一间小会议室开项目讨论，帮我看看有哪些可以用。' }, actor });
  assert.equal(query.ok, true);
  assert.equal(query.data.available.some((item) => item.id === '505'), false);

  const createRuleResult = await handleAgentMessage({ db, input: { message: '这周三 504 临时维修，全天不能预约。' }, actor: admin });
  assert.equal(createRuleResult.ok, true);
  assert.equal(listRules(db).filter((rule) => rule.target_room_id === '504').length, 1);

  const updateRuleResult = await handleAgentMessage({ db, input: { message: '刚才说错了，504 只停用下午。' }, actor: admin });
  assert.equal(updateRuleResult.ok, true);
  assert.equal(listRules(db).filter((rule) => rule.target_room_id === '504').length, 1);
  assert.equal(listRules(db).find((rule) => rule.target_room_id === '504').version, 2);
});
