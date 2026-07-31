import { addDays, getWeekday, parseDateInput, parseTime } from './time.js';

export function normalizeSpaceId(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (/^\d{3}$/.test(text)) return `room${text}`;
  if (text === '会议室一+会议室二' || text === '大会议室') return 'combined-room1-room2';
  return text;
}

function displaySpaceIdForFilter(spaceId) {
  const match = String(spaceId || '').match(/^room(\d{3})$/);
  return match ? match[1] : spaceId;
}

export function combineDateTime(dateInput, timeInput, fallbackDate = new Date().toISOString()) {
  const date = parseDateInput(dateInput, fallbackDate);
  const time = parseTime(timeInput || '00:00');
  return `${date}T${time}:00`;
}

export function getRuleDate(rule) {
  return rule.start_at ? rule.start_at.slice(0, 10) : null;
}

export function ruleAppliesOnDate(rule, dateInput) {
  const date = parseDateInput(dateInput, new Date().toISOString());
  const start = rule.start_at ? rule.start_at.slice(0, 10) : date;
  const end = rule.end_at ? rule.end_at.slice(0, 10) : start;

  if (rule.deleted_at) return false;
  if (rule.recurrence === 'none') {
    return date >= start && date <= end;
  }
  if (rule.recurrence === 'daily') {
    return date >= start;
  }
  if (rule.recurrence === 'weekly') {
    const weekdays = Array.isArray(rule.weekdays) ? rule.weekdays.map(Number) : [];
    return date >= start && weekdays.includes(getWeekday(date));
  }
  return false;
}

export function expandRuleIntervals(rule, dateInput) {
  if (!ruleAppliesOnDate(rule, dateInput)) return [];
  const date = parseDateInput(dateInput, new Date().toISOString());
  const startAt = rule.start_at ? rule.start_at.slice(11, 16) : '00:00';
  const endAt = rule.end_at ? rule.end_at.slice(11, 16) : '23:59';
  return [{ start: `${date}T${startAt}:00`, end: `${date}T${endAt}:00`, rule }];
}

export function expandReservationIntervals(reservation, dateInput) {
  const date = parseDateInput(dateInput, new Date().toISOString());
  const startAt = reservation.start_at ? reservation.start_at.slice(0, 10) : date;
  const endAt = reservation.end_at ? reservation.end_at.slice(0, 10) : startAt;
  if (reservation.status === 'cancelled' || date < startAt || date > endAt) return [];
  return [{ start: reservation.start_at, end: reservation.end_at, reservation }];
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export function getConflictsForSpace({ spaceId, date, startAt, endAt, rooms, combinedSpaces, rules, reservations, excludeReservationId = null }) {
  const normalizedSpaceId = normalizeSpaceId(spaceId);
  const constraints = getConstraintsForSpace({ spaceId: normalizedSpaceId, date, rooms, combinedSpaces, rules, reservations, excludeReservationId });
  return constraints.filter((constraint) => overlaps(startAt, endAt, constraint.start, constraint.end));
}

export function getConstraintsForSpace({ spaceId, date, rooms, combinedSpaces, rules, reservations, excludeReservationId = null }) {
  const normalizedSpaceId = normalizeSpaceId(spaceId);
  const relatedSpaceIds = getRelatedSpaceIds({ spaceId: normalizedSpaceId, combinedSpaces });
  const constraints = [];

  for (const rule of rules) {
    const target = normalizeSpaceId(rule.target_room_id || rule.room_id);
    const combined = normalizeSpaceId(rule.combined_space_id);
    const ruleTargets = new Set([target, combined].filter(Boolean));
    const intersects = [...relatedSpaceIds].some((id) => ruleTargets.has(id));
    if (!intersects) continue;
    for (const interval of expandRuleIntervals(rule, date)) {
      constraints.push({
        type: 'rule',
        ruleType: rule.type,
        reason: rule.reason || rule.type,
        sourceId: rule.id,
        targetSpaceId: rule.target_room_id || rule.room_id || rule.combined_space_id,
        ...interval,
      });
    }
  }

  for (const reservation of reservations) {
    if (reservation.id === excludeReservationId) continue;
    if (reservation.status === 'cancelled') continue;
    const target = normalizeSpaceId(reservation.space_id || reservation.room_id);
    if (!relatedSpaceIds.has(target)) continue;
    for (const interval of expandReservationIntervals(reservation, date)) {
      const isCombinedOccupancy = target.startsWith('combined-');
      constraints.push({
        type: 'reservation',
        reason: isCombinedOccupancy ? `合并空间占用：${reservation.title || '已有预约'}` : (reservation.title || '已有预约'),
        sourceId: reservation.id,
        targetSpaceId: reservation.space_id || reservation.room_id,
        ...interval,
      });
    }
  }

  return constraints;
}

export function getRelatedSpaceIds({ spaceId, combinedSpaces }) {
  const normalizedSpaceId = normalizeSpaceId(spaceId);
  const related = new Set([normalizedSpaceId]);

  for (const combined of combinedSpaces) {
    const components = (combined.component_room_ids || []).map(normalizeSpaceId);
    const combinedId = normalizeSpaceId(combined.id);
    if (combinedId === normalizedSpaceId) {
      for (const component of components) related.add(component);
      continue;
    }
    if (components.includes(normalizedSpaceId)) {
      related.add(combinedId);
    }
  }

  return related;
}

export function getAvailableSpaces({
  date,
  startTime,
  endTime,
  rooms,
  combinedSpaces,
  rules,
  reservations,
  filters = {},
  includeCombinedSpaces = true,
  includeRooms = true,
}) {
  const startAt = combineDateTime(date, startTime);
  const endAt = combineDateTime(date, endTime);
  const results = [];

  const matchesType = (space) => !filters.room_type || space.type === filters.room_type;
  const matchesSpaceId = (space) => {
    const filterId = normalizeSpaceId(filters.room_id || filters.space_id);
    return !filterId || space.id === filterId || space.space_id === filterId || displaySpaceIdForFilter(space.id) === filterId;
  };
  const matchesCapacity = (space) => !filters.capacity_min || Number(space.capacity) >= Number(filters.capacity_min);
  const matchesEquipment = (space) => !filters.equipment?.length || filters.equipment.every((item) => space.equipment?.includes(item));

  if (includeRooms) {
    for (const room of rooms) {
      if (!matchesSpaceId(room) || !matchesType(room) || !matchesCapacity(room) || !matchesEquipment(room)) continue;
      const conflicts = getConflictsForSpace({
        spaceId: room.id,
        date,
        startAt,
        endAt,
        rooms,
        combinedSpaces,
        rules,
        reservations,
      });
      results.push({
        ...room,
        available: conflicts.length === 0,
        conflicts: conflicts.map((item) => ({
          type: item.type,
          reason: item.reason,
          start: item.start,
          end: item.end,
        })),
      });
    }
  }

  if (!includeCombinedSpaces) return results;

  for (const combined of combinedSpaces) {
    if (!matchesType(combined) || !matchesCapacity(combined) || !matchesEquipment(combined)) continue;
    const conflicts = getConflictsForSpace({
      spaceId: combined.id,
      date,
      startAt,
      endAt,
      rooms,
      combinedSpaces,
      rules,
      reservations,
    });
    results.push({
      ...combined,
      available: conflicts.length === 0,
      conflicts: conflicts.map((item) => ({
        type: item.type,
        reason: item.reason,
        start: item.start,
        end: item.end,
      })),
    });
  }

  return results;
}

export function buildRelativeDate(text, currentDateInput) {
  const date = parseDateInput(currentDateInput, new Date().toISOString());
  const today = new Date(`${date}T00:00:00`);
  const currentDay = today.getDay();
  const dayMap = {
    日: 0,
    天: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
  };

  if (/明天/.test(text)) {
    return addDays(date, 1);
  }

  const weekdayMatch = text.match(/(本周|这周|下周)?周([一二三四五六日天])/);
  if (weekdayMatch) {
    const prefix = weekdayMatch[1] || '本周';
    const targetDay = dayMap[weekdayMatch[2]];
    let offset = targetDay - currentDay;
    if (prefix === '下周') offset += 7;
    if (offset < 0) offset += 7;
    return addDays(date, offset);
  }

  const isoMatch = text.match(/(20\d{2}-\d{2}-\d{2})/);
  return isoMatch?.[1] || date;
}

export function buildTimeRange(text) {
  const match = text.match(/(\d{1,2})[:：](\d{2})\s*(?:—|-|到|至)\s*(\d{1,2})[:：](\d{2})/);
  if (!match) return { startTime: '00:00', endTime: '23:59', hasTimeRange: false };
  return {
    startTime: `${String(match[1]).padStart(2, '0')}:${match[2]}`,
    endTime: `${String(match[3]).padStart(2, '0')}:${match[4]}`,
    hasTimeRange: true,
  };
}

export function normalizeEndOfDay(date) {
  return `${date}T23:59:00`;
}
