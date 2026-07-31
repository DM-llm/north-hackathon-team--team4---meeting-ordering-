import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export function openDatabase(dbPath = config.dbPath) {
  const resolvedPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
      display_name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      location TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 100,
      equipment TEXT NOT NULL DEFAULT '[]',
      open_intervals TEXT NOT NULL DEFAULT '[{"start":"09:00","end":"18:00"}]',
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS combined_spaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      component_room_ids TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      equipment TEXT NOT NULL DEFAULT '[]',
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      target_room_id TEXT NOT NULL,
      combined_space_id TEXT,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      recurrence TEXT NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none', 'daily', 'weekly')),
      weekdays TEXT NOT NULL DEFAULT '[]',
      reason TEXT,
      source TEXT NOT NULL DEFAULT 'admin',
      created_by TEXT,
      updated_by TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      organizer_id TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'cancelled', 'forced_adjusted')),
      created_by TEXT NOT NULL,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      actor_id TEXT,
      actor_role TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      before_json TEXT,
      after_json TEXT,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export function seedDatabase(db) {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`DELETE FROM audit_logs`).run();
    db.prepare(`DELETE FROM reservations`).run();
    db.prepare(`DELETE FROM rules`).run();
    db.prepare(`DELETE FROM combined_spaces`).run();
    db.prepare(`DELETE FROM rooms`).run();
    db.prepare(`DELETE FROM users`).run();

    const rooms = [
      {
        id: 'activity',
        name: '活动室',
        type: 'activity',
        location: '1F 北侧',
        capacity: 30,
        equipment: ['投影', '音响', '移动桌椅'],
        open_intervals: [{ start: '09:00', end: '18:00' }],
        note: '中午作为餐厅，午餐时段不可预约会议',
      },
      {
        id: 'room1',
        name: '会议室一',
        type: 'meeting',
        location: '2F A区',
        capacity: 12,
        equipment: ['投影', '白板', '视频会议'],
        open_intervals: [{ start: '09:00', end: '18:00' }],
        note: '可与会议室二合并成大会议室',
      },
      {
        id: 'room2',
        name: '会议室二',
        type: 'meeting',
        location: '2F A区',
        capacity: 12,
        equipment: ['投影', '白板', '视频会议'],
        open_intervals: [{ start: '09:00', end: '18:00' }],
        note: '可与会议室一合并成大会议室',
      },
      {
        id: 'room503',
        name: '503',
        type: 'small',
        location: '5F 东侧',
        capacity: 6,
        equipment: ['白板', '投屏'],
        open_intervals: [{ start: '09:00', end: '18:00' }],
        note: '小会议室',
      },
      {
        id: 'room505',
        name: '505',
        type: 'small',
        location: '5F 东侧',
        capacity: 6,
        equipment: ['白板', '投屏'],
        open_intervals: [{ start: '09:00', end: '18:00' }],
        note: '每周二全天不可用',
      },
      {
        id: 'room506',
        name: '506',
        type: 'small',
        location: '5F 东侧',
        capacity: 6,
        equipment: ['白板', '投屏'],
        open_intervals: [{ start: '09:00', end: '18:00' }],
        note: '小会议室',
      },
    ];

    for (const room of rooms) {
      db.prepare(`
        INSERT OR REPLACE INTO rooms(id, name, type, location, capacity, equipment, open_intervals, note, created_at, updated_at)
        VALUES (@id, @name, @type, @location, @capacity, @equipment, @open_intervals, @note, @created_at, @updated_at)
      `).run({
        ...room,
        equipment: JSON.stringify(room.equipment),
        open_intervals: JSON.stringify(room.open_intervals),
        created_at: now,
        updated_at: now,
      });
    }

    db.prepare(`
      INSERT OR REPLACE INTO combined_spaces(id, name, component_room_ids, capacity, equipment, note, created_at, updated_at)
      VALUES ('combined-room1-room2', '会议室一+会议室二', '["room1","room2"]', 24, '["投影","白板","视频会议"]', '由会议室一和会议室二合并', @created_at, @updated_at)
    `).run({ created_at: now, updated_at: now });

    for (const user of [
      ['demo-admin', 'Demo 管理员', 'admin'],
      ['demo-member', 'Demo 成员', 'member'],
    ]) {
      db.prepare(`
        INSERT OR REPLACE INTO users(id, name, role, display_name, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(user[0], user[1], user[2], user[1], now);
    }

    const fixedRules = [
      {
        id: 'fixed-activity-lunch',
        type: 'lunch_block',
        target_room_id: 'activity',
        combined_space_id: null,
        start_at: '2026-01-01T12:00:00',
        end_at: '2026-01-01T13:30:00',
        recurrence: 'daily',
        weekdays: [],
        reason: '活动室午餐时段作为餐厅使用',
        source: 'system',
        created_by: 'system',
        updated_by: 'system',
        version: 1,
        metadata: JSON.stringify({ fixed: true }),
      },
      {
        id: 'fixed-room505-tuesday',
        type: 'weekly_unavailable',
        target_room_id: 'room505',
        combined_space_id: null,
        start_at: '2026-07-28T00:00:00',
        end_at: '2026-07-28T23:59:00',
        recurrence: 'weekly',
        weekdays: [2],
        reason: '505 每周二全天不可用',
        source: 'system',
        created_by: 'system',
        updated_by: 'system',
        version: 1,
        metadata: JSON.stringify({ fixed: true }),
      },
    ];

    for (const rule of fixedRules) {
      db.prepare(`
        INSERT OR REPLACE INTO rules(id, type, target_room_id, combined_space_id, start_at, end_at, recurrence, weekdays, reason, source, created_by, updated_by, version, created_at, updated_at, deleted_at, metadata)
        VALUES (@id, @type, @target_room_id, @combined_space_id, @start_at, @end_at, @recurrence, @weekdays, @reason, @source, @created_by, @updated_by, @version, @created_at, @updated_at, NULL, @metadata)
      `).run({ ...rule, weekdays: JSON.stringify(rule.weekdays), created_at: now, updated_at: now });
    }

    createAuditLog(db, {
      action: 'demo.reset',
      actor_id: 'system',
      actor_role: 'system',
      entity_type: 'database',
      entity_id: 'demo',
      before_json: null,
      after_json: JSON.stringify({ seed: true }),
      message: 'Demo 数据已重置，保留固定空间和固定规则。',
    });
  })();
}

export function createAuditLog(db, input) {
  const now = new Date().toISOString();
  const id = input.id || `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO audit_logs(id, action, actor_id, actor_role, entity_type, entity_id, before_json, after_json, message, created_at)
    VALUES (@id, @action, @actor_id, @actor_role, @entity_type, @entity_id, @before_json, @after_json, @message, @created_at)
  `).run({ ...input, id, created_at: now });
  return { id, ...input, created_at: now };
}

export function mapRoom(row) {
  if (!row) return null;
  return {
    ...row,
    equipment: safeJson(row.equipment, []),
    open_intervals: safeJson(row.open_intervals, []),
  };
}

export function mapCombinedSpace(row) {
  if (!row) return null;
  return {
    ...row,
    component_room_ids: safeJson(row.component_room_ids, []),
    equipment: safeJson(row.equipment, []),
  };
}

export function mapRule(row) {
  if (!row) return null;
  return {
    ...row,
    weekdays: safeJson(row.weekdays, []),
    metadata: safeJson(row.metadata, {}),
  };
}

export function mapReservation(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: safeJson(row.metadata, {}),
  };
}

export function mapAuditLog(row) {
  if (!row) return null;
  return {
    ...row,
    before: row.before_json ? safeJson(row.before_json, null) : null,
    after: row.after_json ? safeJson(row.after_json, null) : null,
  };
}

export function safeJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
