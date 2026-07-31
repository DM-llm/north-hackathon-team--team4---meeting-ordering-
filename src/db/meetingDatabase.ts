import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  AdminOperation,
  AdminOperationType,
  Booking,
  BusinessResult,
  DemoState,
  DynamicDisablement,
  MergedRoom,
  Room,
  StructuredIntent,
  UnavailabilityRule,
  Weekday,
} from '../types';

export type DatabaseOptions = {
  databasePath?: string;
  reset?: boolean;
};

export type TableRow = Record<string, unknown>;

const DEFAULT_DATABASE_PATH = path.resolve(process.cwd(), 'data', 'meeting-ordering.db');

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function asObject<T>(value: unknown, fallback: T): T {
  return value && typeof value === 'object' ? value as T : fallback;
}

function normalizeDatabasePath(databasePath = DEFAULT_DATABASE_PATH): string {
  const resolved = path.resolve(databasePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function createDatabase(databasePath: string): DatabaseSync {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function rowToJsonColumns(row: TableRow): TableRow {
  const jsonColumns = new Set([
    'equipment',
    'can_merge_with',
    'default_availability',
    'source_room_ids',
    'room_ids',
    'ranges',
    'weekdays',
    'organizer',
    'attendees',
    'details',
    'data',
    'entities',
    'constraints',
  ]);

  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (!jsonColumns.has(key) || typeof value !== 'string') {
        return [key, value];
      }

      try {
        return [key, JSON.parse(value) as unknown];
      } catch {
        return [key, value];
      }
    }),
  );
}

function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

export class MeetingDatabase {
  readonly databasePath: string;

  private readonly db: DatabaseSync;

  constructor(options: DatabaseOptions = {}) {
    this.databasePath = normalizeDatabasePath(options.databasePath);
    this.db = createDatabase(this.databasePath);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  raw(): DatabaseSync {
    return this.db;
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        location TEXT,
        capacity INTEGER,
        equipment TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK(status IN ('active', 'inactive')),
        can_merge_with TEXT NOT NULL DEFAULT '[]',
        merged_room_id TEXT,
        default_availability TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS merged_rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        location TEXT,
        capacity INTEGER,
        equipment TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK(status IN ('active', 'inactive')),
        source_room_ids TEXT NOT NULL DEFAULT '[]',
        merged_room_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        source_room_ids TEXT NOT NULL DEFAULT '[]',
        title TEXT NOT NULL,
        description TEXT,
        organizer TEXT NOT NULL,
        attendees TEXT NOT NULL DEFAULT '[]',
        date TEXT NOT NULL,
        range_start TEXT NOT NULL,
        range_end TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('confirmed', 'cancelled', 'adjusted', 'rejected')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        cancelled_at TEXT,
        adjusted_at TEXT,
        rejection_reason TEXT,
        actor TEXT NOT NULL DEFAULT 'member',
        source TEXT NOT NULL DEFAULT 'api'
      );

      CREATE TABLE IF NOT EXISTS unavailability_rules (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('lunch', 'weeklyUnavailable', 'temporaryMaintenance', 'adminRule', 'mergedRoomBlock')),
        scope TEXT NOT NULL CHECK(scope IN ('room', 'mergedRoom', 'roomGroup')),
        room_ids TEXT NOT NULL DEFAULT '[]',
        title TEXT NOT NULL,
        description TEXT,
        start_date TEXT,
        end_date TEXT,
        weekdays TEXT NOT NULL DEFAULT '[]',
        ranges TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'admin',
        source TEXT NOT NULL DEFAULT 'api'
      );

      CREATE TABLE IF NOT EXISTS dynamic_disables (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        ranges TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'admin',
        source TEXT NOT NULL DEFAULT 'api'
      );

      CREATE TABLE IF NOT EXISTS admin_operations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        actor TEXT NOT NULL,
        target_id TEXT,
        summary TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'api'
      );

      CREATE TABLE IF NOT EXISTS business_results (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'conflict', 'notFound')),
        message TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'api'
      );

      CREATE TABLE IF NOT EXISTS agent_intents (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        entities TEXT NOT NULL DEFAULT '{}',
        constraints TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'api'
      );

      CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
      CREATE INDEX IF NOT EXISTS idx_bookings_room_date ON bookings(room_id, date);
      CREATE INDEX IF NOT EXISTS idx_rules_active ON unavailability_rules(active, start_date, end_date);
      CREATE INDEX IF NOT EXISTS idx_dynamic_active ON dynamic_disables(active, start_date, end_date);
    `);

    this.applyMigration(1);
  }

  private applyMigration(version: number): void {
    const exists = this.db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version);
    if (exists) {
      return;
    }

    this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  reset(): void {
    this.transaction(() => {
      this.db.exec('DELETE FROM agent_intents');
      this.db.exec('DELETE FROM business_results');
      this.db.exec('DELETE FROM admin_operations');
      this.db.exec('DELETE FROM dynamic_disables');
      this.db.exec('DELETE FROM unavailability_rules');
      this.db.exec('DELETE FROM bookings');
      this.db.exec('DELETE FROM merged_rooms');
      this.db.exec('DELETE FROM rooms');
    });
  }

  upsertRoom(room: Room): void {
    this.db.prepare(`
      INSERT INTO rooms (
        id, name, location, capacity, equipment, status, can_merge_with, merged_room_id,
        default_availability, created_at, updated_at
      ) VALUES (
        @id, @name, @location, @capacity, @equipment, @status, @canMergeWith, @mergedRoomId,
        @defaultAvailability, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        location = excluded.location,
        capacity = excluded.capacity,
        equipment = excluded.equipment,
        status = excluded.status,
        can_merge_with = excluded.can_merge_with,
        merged_room_id = excluded.merged_room_id,
        default_availability = excluded.default_availability,
        updated_at = excluded.updated_at
    `).run({
      id: room.id,
      name: room.name,
      location: room.location ?? null,
      capacity: room.capacity ?? null,
      equipment: stringifyJson(room.equipment ?? []),
      status: room.status,
      canMergeWith: stringifyJson(room.canMergeWith ?? []),
      mergedRoomId: room.mergedRoomId ?? null,
      defaultAvailability: stringifyJson(room.defaultAvailability ?? { weekdays: [], ranges: [] }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  upsertMergedRoom(mergedRoom: MergedRoom): void {
    this.db.prepare(`
      INSERT INTO merged_rooms (
        id, name, location, capacity, equipment, status, source_room_ids, merged_room_id,
        created_at, updated_at
      ) VALUES (
        @id, @name, @location, @capacity, @equipment, @status, @sourceRoomIds, @mergedRoomId,
        @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        location = excluded.location,
        capacity = excluded.capacity,
        equipment = excluded.equipment,
        status = excluded.status,
        source_room_ids = excluded.source_room_ids,
        merged_room_id = excluded.merged_room_id,
        updated_at = excluded.updated_at
    `).run({
      id: mergedRoom.id,
      name: mergedRoom.name,
      location: mergedRoom.location ?? null,
      capacity: mergedRoom.capacity ?? null,
      equipment: stringifyJson(mergedRoom.equipment ?? []),
      status: mergedRoom.status,
      sourceRoomIds: stringifyJson(mergedRoom.sourceRoomIds),
      mergedRoomId: mergedRoom.mergedRoomId ?? mergedRoom.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  upsertRule(rule: UnavailabilityRule): void {
    this.db.prepare(`
      INSERT INTO unavailability_rules (
        id, type, scope, room_ids, title, description, start_date, end_date, weekdays,
        ranges, active, created_at, updated_at, actor, source
      ) VALUES (
        @id, @type, @scope, @roomIds, @title, @description, @startDate, @endDate, @weekdays,
        @ranges, @active, @createdAt, @updatedAt, @actor, @source
      )
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        scope = excluded.scope,
        room_ids = excluded.room_ids,
        title = excluded.title,
        description = excluded.description,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        weekdays = excluded.weekdays,
        ranges = excluded.ranges,
        active = excluded.active,
        updated_at = excluded.updated_at
    `).run({
      id: rule.id,
      type: rule.type,
      scope: rule.scope,
      roomIds: stringifyJson(rule.roomIds),
      title: rule.title,
      description: rule.description ?? null,
      startDate: rule.startDate ?? null,
      endDate: rule.endDate ?? null,
      weekdays: stringifyJson(rule.weekdays ?? []),
      ranges: stringifyJson(rule.ranges),
      active: rule.active ? 1 : 0,
      createdAt: rule.createdAt ?? new Date().toISOString(),
      updatedAt: rule.updatedAt ?? new Date().toISOString(),
      actor: 'admin',
      source: 'seed',
    });
  }

  upsertBooking(booking: Booking, actor = 'member', source = 'api'): void {
    this.db.prepare(`
      INSERT INTO bookings (
        id, room_id, source_room_ids, title, description, organizer, attendees, date,
        range_start, range_end, status, created_at, updated_at, cancelled_at,
        adjusted_at, rejection_reason, actor, source
      ) VALUES (
        @id, @roomId, @sourceRoomIds, @title, @description, @organizer, @attendees, @date,
        @rangeStart, @rangeEnd, @status, @createdAt, @updatedAt, @cancelledAt,
        @adjustedAt, @rejectionReason, @actor, @source
      )
      ON CONFLICT(id) DO UPDATE SET
        room_id = excluded.room_id,
        source_room_ids = excluded.source_room_ids,
        title = excluded.title,
        description = excluded.description,
        organizer = excluded.organizer,
        attendees = excluded.attendees,
        date = excluded.date,
        range_start = excluded.range_start,
        range_end = excluded.range_end,
        status = excluded.status,
        updated_at = excluded.updated_at,
        cancelled_at = excluded.cancelled_at,
        adjusted_at = excluded.adjusted_at,
        rejection_reason = excluded.rejection_reason,
        actor = excluded.actor,
        source = excluded.source
    `).run({
      id: booking.id,
      roomId: booking.roomId,
      sourceRoomIds: stringifyJson(booking.sourceRoomIds ?? []),
      title: booking.title,
      description: booking.description ?? null,
      organizer: stringifyJson(booking.organizer),
      attendees: stringifyJson(booking.attendees ?? []),
      date: booking.date,
      rangeStart: booking.range.start,
      rangeEnd: booking.range.end,
      status: booking.status,
      createdAt: booking.createdAt ?? new Date().toISOString(),
      updatedAt: booking.updatedAt ?? new Date().toISOString(),
      cancelledAt: booking.cancelledAt ?? null,
      adjustedAt: booking.adjustedAt ?? null,
      rejectionReason: booking.rejectionReason ?? null,
      actor,
      source,
    });
  }

  upsertDynamicDisable(dynamic: DynamicDisablement, actor = 'admin', source = 'api'): void {
    this.db.prepare(`
      INSERT INTO dynamic_disables (
        id, room_id, reason, start_date, end_date, ranges, active, created_at, updated_at, actor, source
      ) VALUES (
        @id, @roomId, @reason, @startDate, @endDate, @ranges, @active, @createdAt, @updatedAt, @actor, @source
      )
      ON CONFLICT(id) DO UPDATE SET
        room_id = excluded.room_id,
        reason = excluded.reason,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        ranges = excluded.ranges,
        active = excluded.active,
        updated_at = excluded.updated_at,
        actor = excluded.actor,
        source = excluded.source
    `).run({
      id: dynamic.id,
      roomId: dynamic.roomId,
      reason: dynamic.reason,
      startDate: dynamic.startDate,
      endDate: dynamic.endDate ?? null,
      ranges: stringifyJson(dynamic.ranges),
      active: dynamic.active ? 1 : 0,
      createdAt: dynamic.createdAt ?? new Date().toISOString(),
      updatedAt: dynamic.updatedAt ?? new Date().toISOString(),
      actor,
      source,
    });
  }

  upsertAdminOperation(operation: AdminOperation, source = 'api'): void {
    this.db.prepare(`
      INSERT INTO admin_operations (id, type, actor, target_id, summary, details, created_at, source)
      VALUES (@id, @type, @actor, @targetId, @summary, @details, @createdAt, @source)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        actor = excluded.actor,
        target_id = excluded.target_id,
        summary = excluded.summary,
        details = excluded.details,
        source = excluded.source
    `).run({
      id: operation.id,
      type: operation.type,
      actor: operation.actor,
      targetId: operation.targetId ?? null,
      summary: operation.summary,
      details: stringifyJson(operation.details ?? {}),
      createdAt: operation.createdAt ?? new Date().toISOString(),
      source,
    });
  }

  upsertBusinessResult(result: BusinessResult, source = 'api'): void {
    this.db.prepare(`
      INSERT INTO business_results (id, status, message, data, created_at, source)
      VALUES (@id, @status, @message, @data, @createdAt, @source)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        message = excluded.message,
        data = excluded.data,
        source = excluded.source
    `).run({
      id: result.id,
      status: result.status,
      message: result.message,
      data: stringifyJson(result.data ?? {}),
      createdAt: result.createdAt ?? new Date().toISOString(),
      source,
    });
  }

  upsertIntent(intent: StructuredIntent, source = 'api'): void {
    this.db.prepare(`
      INSERT INTO agent_intents (
        id, action, actor_role, raw_text, entities, constraints, created_at, source
      ) VALUES (
        @id, @action, @actorRole, @rawText, @entities, @constraints, @createdAt, @source
      )
      ON CONFLICT(id) DO UPDATE SET
        action = excluded.action,
        actor_role = excluded.actor_role,
        raw_text = excluded.raw_text,
        entities = excluded.entities,
        constraints = excluded.constraints,
        source = excluded.source
    `).run({
      id: intent.id,
      action: intent.action,
      actorRole: intent.actorRole,
      rawText: intent.rawText,
      entities: stringifyJson(intent.entities ?? {}),
      constraints: stringifyJson(intent.constraints ?? {}),
      createdAt: intent.createdAt ?? new Date().toISOString(),
      source,
    });
  }

  loadDemoState(): DemoState {
    const rooms = this.db.prepare('SELECT * FROM rooms ORDER BY name').all().map((row) => this.toRoom(row as TableRow));
    const mergedRooms = this.db.prepare('SELECT * FROM merged_rooms ORDER BY name').all().map((row) => this.toMergedRoom(row as TableRow));
    const bookings = this.db.prepare('SELECT * FROM bookings ORDER BY created_at DESC').all().map((row) => this.toBooking(row as TableRow));
    const unavailabilityRules = this.db.prepare('SELECT * FROM unavailability_rules ORDER BY created_at DESC').all().map((row) => this.toRule(row as TableRow));
    const dynamicDisables = this.db.prepare('SELECT * FROM dynamic_disables ORDER BY created_at DESC').all().map((row) => this.toDynamicDisable(row as TableRow));
    const adminOperations = this.db.prepare('SELECT * FROM admin_operations ORDER BY created_at DESC').all().map((row) => this.toAdminOperation(row as TableRow));
    const businessResults = this.db.prepare('SELECT * FROM business_results ORDER BY created_at DESC').all().map((row) => this.toBusinessResult(row as TableRow));
    const intents = this.db.prepare('SELECT * FROM agent_intents ORDER BY created_at DESC').all().map((row) => this.toIntent(row as TableRow));

    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      rooms,
      mergedRooms,
      bookings,
      unavailabilityRules,
      dynamicDisables,
      adminOperations,
      businessResults,
      intents,
    };
  }

  saveDemoState(state: DemoState): void {
    this.transaction(() => {
      state.rooms.forEach((room) => this.upsertRoom(room));
      state.mergedRooms.forEach((mergedRoom) => this.upsertMergedRoom(mergedRoom));
      state.bookings.forEach((booking) => this.upsertBooking(booking));
      state.unavailabilityRules.forEach((rule) => this.upsertRule(rule));
      state.dynamicDisables.forEach((dynamic) => this.upsertDynamicDisable(dynamic));
      state.adminOperations.forEach((operation) => this.upsertAdminOperation(operation));
      state.businessResults.forEach((result) => this.upsertBusinessResult(result));
      state.intents.forEach((intent) => this.upsertIntent(intent));
    });
  }

  getTableCounts(): Record<string, number> {
    const tables = [
      'rooms',
      'merged_rooms',
      'bookings',
      'unavailability_rules',
      'dynamic_disables',
      'admin_operations',
      'business_results',
      'agent_intents',
    ];

    return Object.fromEntries(
      tables.map((table) => {
        const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
        return [table, row.count];
      }),
    );
  }

  seedDemoData(reset = false): DemoState {
    if (reset) {
      this.reset();
    }

    this.upsertRoom({
      id: 'activity-room',
      name: '活动室',
      location: '一层公共区域',
      capacity: 30,
      equipment: ['投影', '音响'],
      status: 'active',
      canMergeWith: [],
    });
    this.upsertRoom({
      id: 'meeting-room-1',
      name: '会议室一',
      location: '二层',
      capacity: 12,
      equipment: ['投影', '白板'],
      status: 'active',
      canMergeWith: ['meeting-room-2'],
      mergedRoomId: 'meeting-room-1-2',
    });
    this.upsertRoom({
      id: 'meeting-room-2',
      name: '会议室二',
      location: '二层',
      capacity: 12,
      equipment: ['投影', '白板'],
      status: 'active',
      canMergeWith: ['meeting-room-1'],
      mergedRoomId: 'meeting-room-1-2',
    });
    this.upsertRoom({
      id: 'room-503',
      name: '503',
      location: '五层',
      capacity: 6,
      equipment: ['白板'],
      status: 'active',
    });
    this.upsertRoom({
      id: 'room-504',
      name: '504',
      location: '五层',
      capacity: 6,
      equipment: ['白板'],
      status: 'active',
    });
    this.upsertRoom({
      id: 'room-505',
      name: '505',
      location: '五层',
      capacity: 6,
      equipment: ['白板'],
      status: 'active',
    });
    this.upsertRoom({
      id: 'room-506',
      name: '506',
      location: '五层',
      capacity: 6,
      equipment: ['白板'],
      status: 'active',
    });
    this.upsertMergedRoom({
      id: 'meeting-room-1-2',
      name: '会议室一/二合并',
      location: '二层',
      capacity: 24,
      equipment: ['投影', '白板'],
      status: 'active',
      sourceRoomIds: ['meeting-room-1', 'meeting-room-2'],
    });
    this.upsertRule({
      id: 'rule-lunch-activity-room',
      type: 'lunch',
      scope: 'room',
      roomIds: ['activity-room'],
      title: '活动室午餐时段不可预约',
      description: '活动室中午作为餐厅，午餐时段不能预约会议。',
      weekdays: [1, 2, 3, 4, 5],
      ranges: [{ start: '12:00', end: '14:00' }],
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    this.upsertRule({
      id: 'rule-weekly-room-505',
      type: 'weeklyUnavailable',
      scope: 'room',
      roomIds: ['room-505'],
      title: '505 每周二全天不可用',
      description: '505 每周二全天不可预约。',
      weekdays: [2],
      ranges: [{ start: '00:00', end: '24:00' }],
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return this.loadDemoState();
  }

  private toRoom(row: TableRow): Room {
    const data = rowToJsonColumns(row);
    return {
      id: String(data.id),
      name: String(data.name),
      location: typeof data.location === 'string' ? data.location : undefined,
      capacity: typeof data.capacity === 'number' ? data.capacity : undefined,
      equipment: asStringArray(data.equipment),
      status: data.status as Room['status'],
      canMergeWith: asStringArray(data.canMergeWith).length > 0 ? asStringArray(data.canMergeWith) : undefined,
      mergedRoomId: typeof data.mergedRoomId === 'string' ? data.mergedRoomId : undefined,
      defaultAvailability: asObject(data.defaultAvailability, { weekdays: [], ranges: [] }),
      createdAt: String(data.createdAt ?? data.created_at),
      updatedAt: String(data.updatedAt ?? data.updated_at),
    };
  }

  private toMergedRoom(row: TableRow): MergedRoom {
    const data = rowToJsonColumns(row);
    return {
      id: String(data.id),
      name: String(data.name),
      location: typeof data.location === 'string' ? data.location : undefined,
      capacity: typeof data.capacity === 'number' ? data.capacity : undefined,
      equipment: asStringArray(data.equipment),
      status: data.status as MergedRoom['status'],
      sourceRoomIds: asStringArray(data.sourceRoomIds),
      mergedRoomId: typeof data.mergedRoomId === 'string' ? data.mergedRoomId : undefined,
      createdAt: String(data.createdAt ?? data.created_at),
      updatedAt: String(data.updatedAt ?? data.updated_at),
    };
  }

  private toBooking(row: TableRow): Booking {
    const data = rowToJsonColumns(row);
    return {
      id: String(data.id),
      roomId: String(data.roomId ?? data.room_id),
      sourceRoomIds: asStringArray(data.sourceRoomIds),
      title: String(data.title),
      description: typeof data.description === 'string' ? data.description : undefined,
      organizer: asObject(data.organizer, { name: 'unknown' }),
      attendees: asObject(data.attendees, []),
      date: String(data.date),
      range: {
        start: String(data.rangeStart ?? data.range_start),
        end: String(data.rangeEnd ?? data.range_end),
      },
      status: data.status as Booking['status'],
      createdAt: String(data.createdAt ?? data.created_at),
      updatedAt: String(data.updatedAt ?? data.updated_at),
      cancelledAt: typeof data.cancelledAt === 'string' ? data.cancelledAt : undefined,
      adjustedAt: typeof data.adjustedAt === 'string' ? data.adjustedAt : undefined,
      rejectionReason: typeof data.rejectionReason === 'string' ? data.rejectionReason : undefined,
    };
  }

  private toRule(row: TableRow): UnavailabilityRule {
    const data = rowToJsonColumns(row);
    return {
      id: String(data.id),
      type: data.type as UnavailabilityRule['type'],
      scope: data.scope as UnavailabilityRule['scope'],
      roomIds: asStringArray(data.roomIds ?? data.room_ids),
      title: String(data.title),
      description: typeof data.description === 'string' ? data.description : undefined,
      startDate: typeof data.startDate === 'string' ? data.startDate : undefined,
      endDate: typeof data.endDate === 'string' ? data.endDate : undefined,
      weekdays: asStringArray(data.weekdays).map((day) => Number(day) as Weekday),
      ranges: asObject(data.ranges, []),
      active: Number(data.active) !== 0,
      createdAt: String(data.createdAt ?? data.created_at),
      updatedAt: String(data.updatedAt ?? data.updated_at),
    };
  }

  private toDynamicDisable(row: TableRow): DynamicDisablement {
    const data = rowToJsonColumns(row);
    return {
      id: String(data.id),
      roomId: String(data.roomId ?? data.room_id),
      reason: String(data.reason),
      startDate: String(data.startDate ?? data.start_date),
      endDate: typeof data.endDate === 'string' ? data.endDate : undefined,
      ranges: asObject(data.ranges, []),
      active: Number(data.active) !== 0,
      createdAt: String(data.createdAt ?? data.created_at),
      updatedAt: String(data.updatedAt ?? data.updated_at),
    };
  }

  private toAdminOperation(row: TableRow): AdminOperation {
    const data = rowToJsonColumns(row);
    return {
      id: String(data.id),
      type: String(data.type) as AdminOperationType,
      actor: String(data.actor),
      targetId: typeof data.targetId === 'string' ? data.targetId : (typeof data.target_id === 'string' ? data.target_id : undefined),
      summary: String(data.summary),
      details: asObject(data.details, {}),
      createdAt: String(data.createdAt ?? data.created_at),
    };
  }

  private toBusinessResult(row: TableRow): BusinessResult {
    const data = rowToJsonColumns(row);
    return {
      id: String(data.id),
      status: data.status as BusinessResult['status'],
      message: String(data.message),
      data: asObject(data.data, {}),
      createdAt: String(data.createdAt ?? data.created_at),
    };
  }

  private toIntent(row: TableRow): StructuredIntent {
    const data = rowToJsonColumns(row);
    return {
      id: String(data.id),
      action: data.action as StructuredIntent['action'],
      actorRole: data.actorRole as StructuredIntent['actorRole'],
      rawText: String(data.rawText),
      entities: asObject(data.entities, {}),
      constraints: asObject(data.constraints, {}),
      createdAt: String(data.createdAt ?? data.created_at),
    };
  }
}

export function createMeetingDatabase(options: DatabaseOptions = {}): MeetingDatabase {
  return new MeetingDatabase(options);
}

export { snakeCase };
