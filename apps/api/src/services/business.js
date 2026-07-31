import {
  createAuditLog,
  mapAuditLog,
  mapCombinedSpace,
  mapReservation,
  mapRoom,
  mapRule,
} from '../db/index.js';
import { getAvailableSpaces, getConflictsForSpace, normalizeSpaceId } from '../domain/rule-engine.js';
import { normalizeDateTimeInput, normalizeRoomId } from '../domain/normalizer.js';
import { addMinutes, nowIso, parseDateInput, parseTime } from '../domain/time.js';

const DEFAULT_OPEN_INTERVALS = [{ start: '09:00', end: '18:00' }];

function displaySpaceId(spaceId) {
  const match = String(spaceId || '').match(/^room(\d{3})$/);
  return match ? match[1] : spaceId;
}

function withSpaceAliases(space) {
  return {
    ...space,
    space_id: displaySpaceId(space.id || space.space_id),
    room_id: space.id || space.space_id,
  };
}

export function listRooms(db, options = {}) {
  const date = options.date || new Date().toISOString().slice(0, 10);
  const time = parseTime(options.time || options.start || options.start_time || '10:00');
  const end = addMinutes(time, 60);
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY sort_order, id').all().map(mapRoom);
  const combinedSpaces = db.prepare('SELECT * FROM combined_spaces ORDER BY id').all().map(mapCombinedSpace);
  const includeCombinedSpaces = Boolean(options.includeCombinedSpaces);
  const constraints = {
    date,
    rooms,
    combinedSpaces,
    rules: listRules(db),
    reservations: listReservations(db, { includeCancelled: true }),
  };
  const spacesToMap = includeCombinedSpaces ? [...rooms, ...combinedSpaces] : rooms;

  return spacesToMap.map((space) => {
    const conflicts = getConflictsForSpace({
      spaceId: space.id,
      date,
      startAt: `${date}T${time}:00`,
      endAt: `${date}T${end}:00`,
      ...constraints,
    });
    return {
      ...space,
      status: conflicts.length ? (conflicts[0].type === 'rule' ? 'blocked' : 'occupied') : 'available',
      conflicts: conflicts.map((item) => ({
        type: item.type,
        ruleType: item.ruleType,
        reason: item.reason,
        start: item.start,
        end: item.end,
        sourceId: item.sourceId,
      })),
    };
  });
}

export function listCombinedSpaces(db) {
  return db.prepare('SELECT * FROM combined_spaces ORDER BY id').all().map(mapCombinedSpace);
}

export function getAvailability(db, input) {
  const date = parseDateInput(input.date || input.current_date, new Date().toISOString());
  const start = parseTime(input.start_time || input.start || input.startTime || '09:00');
  const end = parseTime(input.end_time || input.end || input.endTime || '10:00');
  const startAt = `${date}T${start}:00`;
  const endAt = `${date}T${end}:00`;
  const filters = parseCriteria(input.criteria || input.filters || input);
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY sort_order, id').all().map(mapRoom);
  const combinedSpaces = db.prepare('SELECT * FROM combined_spaces ORDER BY id').all().map(mapCombinedSpace);
  const rules = listRules(db);
  const reservations = listReservations(db, { includeCancelled: false });
  const constraints = { date, rooms, combinedSpaces, rules, reservations };
  const roomResults = getAvailableSpaces({ date, startTime: start, endTime: end, ...constraints, filters, includeCombinedSpaces: false });
  const includeCombined = !filters.room_type || filters.room_type === 'combined';
  const singleSpaceFilter = normalizeSpaceId(filters.room_id || filters.space_id);
  const isSingleCombinedFilter = singleSpaceFilter.startsWith('combined-');
  const combinedResults = includeCombined || isSingleCombinedFilter
    ? getAvailableSpaces({ date, startTime: start, endTime: end, ...constraints, filters, includeCombinedSpaces: true, includeRooms: !singleSpaceFilter || isSingleCombinedFilter })
    : [];
  const all = [...roomResults, ...combinedResults].map(withSpaceAliases);
  const available = all.filter((item) => item.available).sort((a, b) => Number(a.capacity) - Number(b.capacity));
  const unavailable = all.filter((item) => !item.available);

  return {
    date,
    start_time: start,
    end_time: end,
    start_at: startAt,
    end_at: endAt,
    available,
    unavailable,
    reply: available.length
      ? `可用空间：${available.map((item) => `${item.name}（${item.capacity}人）`).join('、')}。`
      : `该时段没有可用空间：${unavailable.map((item) => `${item.name}：${formatConflicts(item.conflicts)}`).join('；')}。`,
  };
}

export function getFloorPlan(db, options = {}) {
  const rooms = listRooms(db, options);
  const combinedSpaces = listCombinedSpaces(db);
  const rules = listRules(db);
  const reservations = listReservations(db, { includeCancelled: false });
  const date = options.date || new Date().toISOString().slice(0, 10);
  const time = parseTime(options.time || '10:00');
  const startAt = `${date}T${time}:00`;
  const endAt = `${date}T${addMinutes(time, 60)}:00`;
  const nodes = rooms.map((room) => {
    const conflicts = getConflictsForSpace({ spaceId: room.id, date, startAt, endAt, rooms, combinedSpaces, rules, reservations });
    return {
      ...room,
      status: conflicts.length ? (conflicts[0].type === 'rule' ? 'blocked' : 'occupied') : 'available',
      conflicts,
    };
  });
  return {
    date,
    time,
    nodes,
    combined_spaces: combinedSpaces,
    rules,
    reservations,
  };
}

export function createRoom(db, input, ctx = {}) {
  requireAdmin(ctx);
  const now = nowIso();
  const room = {
    id: normalizeRoomId(input.id || input.room_id),
    name: input.name || input.room_name || input.id || input.room_id,
    type: input.type || 'small',
    location: input.location || '待补充',
    capacity: Number(input.capacity || 6),
    equipment: Array.isArray(input.equipment) ? input.equipment : ['白板'],
    open_intervals: input.open_intervals || DEFAULT_OPEN_INTERVALS,
    note: input.note || '管理员新增会议室',
    sort_order: Number(input.sort_order || 100),
  };
  if (!room.id) throw httpError(400, '缺少会议室 ID');
  db.prepare(`
    INSERT INTO rooms(id, name, type, location, capacity, equipment, open_intervals, note, created_at, updated_at, sort_order)
    VALUES (@id, @name, @type, @location, @capacity, @equipment, @open_intervals, @note, @created_at, @updated_at, @sort_order)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      location = excluded.location,
      capacity = excluded.capacity,
      equipment = excluded.equipment,
      open_intervals = excluded.open_intervals,
      note = excluded.note,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `).run({ ...room, equipment: JSON.stringify(room.equipment), open_intervals: JSON.stringify(room.open_intervals), created_at: now, updated_at: now });
  const after = db.prepare('SELECT * FROM rooms WHERE id = ?').get(room.id);
  createAuditLog(db, {
    action: 'room.upsert',
    actor_id: ctx.actor_id,
    actor_role: ctx.actor_role,
    entity_type: 'room',
    entity_id: room.id,
    before_json: null,
    after_json: JSON.stringify(mapRoom(after)),
    message: `管理员配置会议室：${room.name}`,
  });
  return { data: mapRoom(after), reply: `会议室 ${room.name} 已配置。` };
}

export function updateRoom(db, roomId, input, ctx = {}) {
  requireAdmin(ctx);
  const before = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!before) throw httpError(404, '会议室不存在');
  const now = nowIso();
  const updates = [];
  const params = { id: roomId, updated_at: now };
  for (const key of ['name', 'type', 'location', 'capacity', 'note', 'sort_order']) {
    if (input[key] !== undefined) {
      updates.push(`${key} = @${key}`);
      params[key] = input[key];
    }
  }
  if (Array.isArray(input.equipment)) {
    updates.push('equipment = @equipment');
    params.equipment = JSON.stringify(input.equipment);
  }
  if (input.open_intervals) {
    updates.push('open_intervals = @open_intervals');
    params.open_intervals = JSON.stringify(input.open_intervals);
  }
  if (!updates.length) throw httpError(400, '没有可更新的会议室字段');
  db.prepare(`UPDATE rooms SET ${updates.join(', ')}, updated_at = @updated_at WHERE id = @id`).run(params);
  const after = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  createAuditLog(db, {
    action: 'room.update',
    actor_id: ctx.actor_id,
    actor_role: ctx.actor_role,
    entity_type: 'room',
    entity_id: roomId,
    before_json: JSON.stringify(mapRoom(before)),
    after_json: JSON.stringify(mapRoom(after)),
    message: `管理员修改会议室：${after.name}`,
  });
  return { data: mapRoom(after), reply: `会议室 ${after.name} 已更新。` };
}

export function listRules(db) {
  return db.prepare('SELECT * FROM rules WHERE deleted_at IS NULL ORDER BY updated_at DESC, created_at DESC').all().map(mapRule);
}

export function createRule(db, input, ctx = {}) {
  requireAdmin(ctx);
  const now = nowIso();
  const rawTargetRoomId = input.target_room_id || input.room_id || input.space_id || input.parameters?.target_room_id;
  const targetRoomId = normalizeRoomId(rawTargetRoomId);
  const storedTargetRoomId = displaySpaceId(targetRoomId);
  if (!targetRoomId) throw httpError(400, '缺少目标空间');
  ensureRoomForRule(db, targetRoomId);
  const date = parseDateInput(input.date || input.parameters?.date, now);
  const startAt = normalizeDateTimeInput(input.start_at || input.startAt || input.parameters?.start_at, `${date}T${parseTime(input.start_time || input.startTime || '00:00')}:00`);
  const endAt = normalizeDateTimeInput(input.end_at || input.endAt || input.parameters?.end_at, `${date}T${parseTime(input.end_time || input.endTime || '23:59')}:00`);
  if (startAt >= endAt) throw httpError(400, '规则结束时间必须晚于开始时间');
  const id = input.rule_id || input.id || `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const rule = {
    id,
    type: input.type || input.rule_type || 'temporary_unavailable',
    target_room_id: storedTargetRoomId,
    combined_space_id: normalizeSpaceId(input.combined_space_id || input.parameters?.combined_space_id) || null,
    start_at: startAt,
    end_at: endAt,
    recurrence: input.recurrence || input.parameters?.recurrence || 'none',
    weekdays: Array.isArray(input.weekdays) ? input.weekdays : [],
    reason: input.reason || input.parameters?.reason || '管理员新增不可预约规则',
    source: input.source || 'admin',
    created_by: ctx.actor_id,
    updated_by: ctx.actor_id,
    version: 1,
    metadata: input.metadata || {},
  };
  db.prepare(`
    INSERT INTO rules(id, type, target_room_id, combined_space_id, start_at, end_at, recurrence, weekdays, reason, source, created_by, updated_by, version, created_at, updated_at, deleted_at, metadata)
    VALUES (@id, @type, @target_room_id, @combined_space_id, @start_at, @end_at, @recurrence, @weekdays, @reason, @source, @created_by, @updated_by, @version, @created_at, @updated_at, NULL, @metadata)
  `).run({ ...rule, weekdays: JSON.stringify(rule.weekdays), created_at: now, updated_at: now, metadata: JSON.stringify(rule.metadata) });
  const after = db.prepare('SELECT * FROM rules WHERE id = ?').get(id);
  createAuditLog(db, {
    action: 'rule.create',
    actor_id: ctx.actor_id,
    actor_role: ctx.actor_role,
    entity_type: 'rule',
    entity_id: id,
    before_json: null,
    after_json: JSON.stringify(mapRule(after)),
    message: `管理员新增规则：${rule.reason}`,
  });
  return { data: mapRule(after), reply: `不可预约规则已新增：${rule.reason}。` };
}

export function updateRule(db, ruleId, input, ctx = {}) {
  requireAdmin(ctx);
  const before = db.prepare('SELECT * FROM rules WHERE id = ? AND deleted_at IS NULL').get(ruleId);
  if (!before) throw httpError(404, '规则不存在');
  const now = nowIso();
  const updates = [];
  const params = { id: ruleId, updated_at: now, version: Number(before.version) + 1 };
  const updateDate = parseDateInput(input.date || before.start_at || now);
  const startAt = input.start_at !== undefined
    ? normalizeDateTimeInput(input.start_at, `${updateDate}T00:00:00`)
    : (input.startAt !== undefined
      ? normalizeDateTimeInput(input.startAt, `${updateDate}T00:00:00`)
      : (input.start_time !== undefined ? `${updateDate}T${parseTime(input.start_time)}:00` : undefined));
  const endAt = input.end_at !== undefined
    ? normalizeDateTimeInput(input.end_at, `${updateDate}T23:59:00`)
    : (input.endAt !== undefined
      ? normalizeDateTimeInput(input.endAt, `${updateDate}T23:59:00`)
      : (input.end_time !== undefined ? `${updateDate}T${parseTime(input.end_time)}:00` : undefined));
  if (startAt !== undefined) {
    updates.push('start_at = @start_at');
    params.start_at = startAt;
  }
  if (endAt !== undefined) {
    updates.push('end_at = @end_at');
    params.end_at = endAt;
  }
  if (startAt !== undefined && endAt !== undefined && startAt >= endAt) throw httpError(400, '规则结束时间必须晚于开始时间');
  for (const key of ['type', 'combined_space_id', 'recurrence', 'reason', 'source']) {
    if (input[key] !== undefined) {
      updates.push(`${key} = @${key}`);
      params[key] = input[key];
    }
  }
  if (input.target_room_id !== undefined) {
    const targetRoomId = normalizeRoomId(input.target_room_id);
    ensureRoomForRule(db, targetRoomId);
    updates.push('target_room_id = @target_room_id');
    params.target_room_id = displaySpaceId(targetRoomId);
  }
  if (Array.isArray(input.weekdays)) {
    updates.push('weekdays = @weekdays');
    params.weekdays = JSON.stringify(input.weekdays);
  }
  if (input.metadata !== undefined) {
    updates.push('metadata = @metadata');
    params.metadata = JSON.stringify(input.metadata);
  }
  if (!updates.length) throw httpError(400, '没有可更新的规则字段');
  params.updated_by = ctx.actor_id;
  updates.push('updated_by = @updated_by', 'version = @version', 'updated_at = @updated_at');
  db.prepare(`UPDATE rules SET ${updates.join(', ')} WHERE id = @id`).run(params);
  const after = db.prepare('SELECT * FROM rules WHERE id = ?').get(ruleId);
  createAuditLog(db, {
    action: 'rule.update',
    actor_id: ctx.actor_id,
    actor_role: ctx.actor_role,
    entity_type: 'rule',
    entity_id: ruleId,
    before_json: JSON.stringify(mapRule(before)),
    after_json: JSON.stringify(mapRule(after)),
    message: `管理员修改规则：${after.reason}`,
  });
  return { data: mapRule(after), reply: `规则已更新为第 ${params.version} 版。` };
}

export function deleteRule(db, ruleId, ctx = {}) {
  requireAdmin(ctx);
  const before = db.prepare('SELECT * FROM rules WHERE id = ? AND deleted_at IS NULL').get(ruleId);
  if (!before) throw httpError(404, '规则不存在');
  const now = nowIso();
  db.prepare('UPDATE rules SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(now, ctx.actor_id, now, ruleId);
  createAuditLog(db, {
    action: 'rule.delete',
    actor_id: ctx.actor_id,
    actor_role: ctx.actor_role,
    entity_type: 'rule',
    entity_id: ruleId,
    before_json: JSON.stringify(mapRule(before)),
    after_json: null,
    message: '管理员删除不可预约规则。',
  });
  return { data: { id: ruleId, deleted_at: now }, reply: '规则已删除。' };
}

export function latestRuleForTarget(db, targetRoomId) {
  const normalized = normalizeRoomId(targetRoomId);
  const displayAlias = displaySpaceId(normalized);
  return db.prepare('SELECT * FROM rules WHERE (target_room_id = ? OR target_room_id = ?) AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1')
    .get(normalized, displayAlias);
}

export function listReservations(db, options = {}) {
  const includeCancelled = Boolean(options.includeCancelled);
  const rows = db.prepare('SELECT * FROM reservations ORDER BY start_at DESC, created_at DESC').all().map(mapReservation);
  return includeCancelled ? rows : rows.filter((item) => item.status !== 'cancelled');
}

export function createReservation(db, input, ctx = {}) {
  const actor = ctx || {};
  const now = nowIso();
  const spaceId = normalizeSpaceId(input.space_id || input.room_id || input.target_room_id || input.parameters?.space_id);
  if (!spaceId) throw httpError(400, '缺少预约空间');
  const date = parseDateInput(input.date || input.parameters?.date, now);
  const startAt = normalizeDateTimeInput(input.start_at || input.startAt || input.parameters?.start_at, `${date}T${parseTime(input.start_time || input.startTime || '09:00')}:00`);
  const endAt = normalizeDateTimeInput(input.end_at || input.endAt || input.parameters?.end_at, `${date}T${parseTime(input.end_time || input.endTime || '10:00')}:00`);
  if (startAt >= endAt) throw httpError(400, '预约结束时间必须晚于开始时间');
  const conflicts = getConflictsForSpace({
    spaceId,
    date: startAt.slice(0, 10),
    startAt,
    endAt,
    rooms: db.prepare('SELECT * FROM rooms').all().map(mapRoom),
    combinedSpaces: listCombinedSpaces(db),
    rules: listRules(db),
    reservations: listReservations(db, { includeCancelled: false }),
  });
  if (conflicts.length) {
    throw httpError(409, `该空间在 ${startAt} 到 ${endAt} 不可预约：${formatConflicts(conflicts)}`, { conflicts });
  }
  const id = input.reservation_id || input.id || `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const reservation = {
    id,
    space_id: spaceId,
    title: input.title || input.parameters?.title || 'Agent 自然语言会议',
    description: input.description || input.parameters?.description || '',
    organizer_id: input.organizer_id || actor.actor_id || 'demo-member',
    start_at: startAt,
    end_at: endAt,
    status: 'active',
    created_by: actor.actor_id || 'demo-member',
    updated_by: actor.actor_id || null,
    metadata: input.metadata || {},
  };
  db.prepare(`
    INSERT INTO reservations(id, space_id, title, description, organizer_id, start_at, end_at, status, created_by, updated_by, created_at, updated_at, metadata)
    VALUES (@id, @space_id, @title, @description, @organizer_id, @start_at, @end_at, @status, @created_by, @updated_by, @created_at, @updated_at, @metadata)
  `).run({ ...reservation, created_at: now, updated_at: now, metadata: JSON.stringify(reservation.metadata) });
  const after = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  createAuditLog(db, {
    action: 'reservation.create',
    actor_id: actor.actor_id,
    actor_role: actor.actor_role,
    entity_type: 'reservation',
    entity_id: id,
    before_json: null,
    after_json: JSON.stringify(mapReservation(after)),
    message: `创建预约：${reservation.title}`,
  });
  return { data: mapReservation(after), reply: `预约已创建：${reservation.title}。` };
}

export function cancelReservation(db, reservationId, ctx = {}) {
  const actor = ctx || {};
  const before = db.prepare('SELECT * FROM reservations WHERE id = ? AND status <> ?').get(reservationId, 'cancelled');
  if (!before) throw httpError(404, '预约不存在或已取消');
  if (actor.actor_role !== 'admin' && before.organizer_id !== actor.actor_id) {
    throw httpError(403, '只能取消自己的预约');
  }
  const now = nowIso();
  db.prepare('UPDATE reservations SET status = ?, updated_by = ?, updated_at = ? WHERE id = ?').run('cancelled', actor.actor_id || null, now, reservationId);
  const after = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
  createAuditLog(db, {
    action: 'reservation.cancel',
    actor_id: actor.actor_id,
    actor_role: actor.actor_role,
    entity_type: 'reservation',
    entity_id: reservationId,
    before_json: JSON.stringify(mapReservation(before)),
    after_json: JSON.stringify(mapReservation(after)),
    message: '预约已取消，对应时段已释放。',
  });
  return { data: mapReservation(after), reply: '预约已取消，对应时段已释放。' };
}

export function updateReservation(db, reservationId, input, ctx = {}) {
  const actor = ctx || {};
  if (actor.actor_role !== 'admin') throw httpError(403, '只有管理员可以调整预约');
  const before = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
  if (!before) throw httpError(404, '预约不存在');
  const now = nowIso();
  const spaceId = normalizeSpaceId(input.space_id || input.room_id || input.parameters?.space_id || before.space_id);
  const date = parseDateInput(input.date || input.parameters?.date, before.start_at || now);
  const startAt = normalizeDateTimeInput(input.start_at || input.startAt || input.parameters?.start_at, `${date}T${parseTime(input.start_time || input.startTime || before.start_at.slice(11, 16))}:00`);
  const endAt = normalizeDateTimeInput(input.end_at || input.endAt || input.parameters?.end_at, `${date}T${parseTime(input.end_time || input.endTime || before.end_at.slice(11, 16))}:00`);
  if (startAt >= endAt) throw httpError(400, '预约结束时间必须晚于开始时间');
  const constraints = {
    date: startAt.slice(0, 10),
    rooms: db.prepare('SELECT * FROM rooms').all().map(mapRoom),
    combinedSpaces: listCombinedSpaces(db),
    rules: listRules(db),
    reservations: listReservations(db, { includeCancelled: false }),
  };
  const conflicts = getConflictsForSpace({ spaceId, startAt, endAt, excludeReservationId: reservationId, ...constraints });
  if (input.force) {
    const fixedConflicts = conflicts.filter((item) => item.type === 'rule');
    if (fixedConflicts.length) {
      throw httpError(409, `强制调整不能覆盖固定/禁用规则：${formatConflicts(fixedConflicts)}`, { conflicts: fixedConflicts });
    }
    for (const conflict of conflicts.filter((item) => item.type === 'reservation' && item.sourceId)) {
      db.prepare('UPDATE reservations SET status = ?, updated_by = ?, updated_at = ?, metadata = json_set(metadata, "$.forced_cancel_reason", ?) WHERE id = ?')
        .run('cancelled', actor.actor_id || null, now, '被管理员强制调整覆盖', conflict.sourceId);
      const cancelled = db.prepare('SELECT * FROM reservations WHERE id = ?').get(conflict.sourceId);
      createAuditLog(db, {
        action: 'reservation.force_cancel_conflict',
        actor_id: actor.actor_id,
        actor_role: actor.actor_role,
        entity_type: 'reservation',
        entity_id: conflict.sourceId,
        before_json: JSON.stringify(mapReservation(conflict.reservation || cancelled)),
        after_json: JSON.stringify(mapReservation(cancelled)),
        message: '该预约被管理员强制调整覆盖并取消。',
      });
    }
  } else if (conflicts.length) {
    throw httpError(409, `调整后的预约存在冲突：${formatConflicts(conflicts)}`, { conflicts });
  }
  const title = input.title || input.parameters?.title || before.title;
  const description = input.description ?? input.parameters?.description ?? before.description;
  const metadata = { ...(before.metadata || {}), ...(input.metadata || {}), force: Boolean(input.force), reason: input.reason || input.parameters?.reason || '管理员调整预约' };
  db.prepare(`
    UPDATE reservations
    SET space_id = @space_id, title = @title, description = @description, start_at = @start_at, end_at = @end_at, status = @status, updated_by = @updated_by, updated_at = @updated_at, metadata = @metadata
    WHERE id = @id
  `).run({
    id: reservationId,
    space_id: spaceId,
    title,
    description,
    start_at: startAt,
    end_at: endAt,
    status: input.force ? 'forced_adjusted' : 'active',
    updated_by: actor.actor_id || null,
    updated_at: now,
    metadata: JSON.stringify(metadata),
  });
  const after = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
  createAuditLog(db, {
    action: input.force ? 'reservation.force_update' : 'reservation.update',
    actor_id: actor.actor_id,
    actor_role: actor.actor_role,
    entity_type: 'reservation',
    entity_id: reservationId,
    before_json: JSON.stringify(mapReservation(before)),
    after_json: JSON.stringify(mapReservation(after)),
    message: input.force ? '管理员强制调整预约。' : '管理员修改预约。',
  });
  return { data: mapReservation(after), reply: input.force ? '预约已强制调整。' : '预约已修改。' };
}

export function latestReservationForSpace(db, spaceId, date) {
  const normalized = normalizeSpaceId(spaceId);
  const start = `${date}T00:00:00`;
  const end = `${date}T23:59:59`;
  return db.prepare('SELECT * FROM reservations WHERE space_id = ? AND start_at >= ? AND end_at <= ? AND status <> ? ORDER BY start_at DESC LIMIT 1')
    .get(normalized, start, end, 'cancelled');
}

export function listAuditLogs(db) {
  return db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200').all().map(mapAuditLog);
}

function ensureRoomForRule(db, roomId) {
  const normalized = normalizeRoomId(roomId);
  if (!normalized) return;
  if (normalized === 'combined-room1-room2') return;
  const exists = db.prepare('SELECT id FROM rooms WHERE id = ?').get(normalized);
  if (exists) return;
  const name = normalized.replace(/^room/, '');
  db.prepare(`
    INSERT OR IGNORE INTO rooms(id, name, type, location, capacity, equipment, open_intervals, note, created_at, updated_at, sort_order)
    VALUES (?, ?, 'small', '5F 东侧', 6, ?, ?, ?, ?, ?, 90)
  `).run(normalized, name, JSON.stringify(['白板', '投屏']), JSON.stringify(DEFAULT_OPEN_INTERVALS), '临时维护目标空间', nowIso(), nowIso());
}

function parseCriteria(criteria) {
  if (!criteria || typeof criteria !== 'object') return {};
  const text = criteria.criteria || criteria.text || criteria.q || criteria.keyword || '';
  const filters = {
    room_type: criteria.room_type || criteria.type || null,
    room_id: criteria.room_id || criteria.space_id || null,
    capacity_min: Number(criteria.capacity_min || criteria.capacityMin || 0) || 0,
    equipment: Array.isArray(criteria.equipment) ? criteria.equipment : [],
  };
  if (/小会议室|小会|项目讨论/.test(text)) filters.room_type = 'small';
  if (/大会议|大会议室|合并|大空间/.test(text)) filters.room_type = 'combined';
  if (/活动室|午餐/.test(text)) filters.room_type = 'activity';
  if (/投影/.test(text) && !filters.equipment.length) filters.equipment.push('投影');
  return filters;
}

function formatConflicts(conflicts) {
  if (!Array.isArray(conflicts) || !conflicts.length) return '无冲突';
  return conflicts.map((item) => `${item.reason || item.ruleType || item.type} ${item.start?.slice(11, 16) || ''}-${item.end?.slice(11, 16) || ''}`).join('；');
}

function requireAdmin(ctx = {}) {
  if (ctx.actor_role !== 'admin' && ctx.role !== 'admin') {
    throw httpError(403, '只有管理员可以执行该操作');
  }
}

function httpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}
