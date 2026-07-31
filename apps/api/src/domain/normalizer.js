import { nowIso } from './time.js';

export function normalizeDateTimeInput(value, fallbackDate = new Date().toISOString()) {
  if (!value) return fallbackDate;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    return text.length === 16 ? `${text}:00` : text;
  }
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text)) {
    return `${text.slice(0, 10)}T${text.slice(11, 16)}:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00`;
  return fallbackDate;
}

export function normalizeTimeOnly(value, fallback = '00:00') {
  if (!value) return fallback;
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  return `${String(Number(match[1])).padStart(2, '0')}:${String(Number(match[2])).padStart(2, '0')}`;
}

export function normalizeRoomId(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (/^\d{3}$/.test(text)) return `room${text}`;
  return text;
}

export function normalizeCombinedSpaceId(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (text === '会议室一+会议室二' || text === '大会议室') return 'combined-room1-room2';
  return text;
}

export function buildRoomPayload(input) {
  return {
    id: normalizeRoomId(input.id || input.room_id || input.target_room_id || input.space_id),
    name: input.name || (normalizeRoomId(input.id || input.room_id || input.target_room_id || input.space_id) === 'room504' ? '504' : input.name),
    type: input.type || 'small',
    location: input.location || '5F 东侧',
    capacity: Number(input.capacity || 6),
    equipment: Array.isArray(input.equipment) ? input.equipment : ['白板', '投屏'],
    note: input.note || '临时维护目标空间',
  };
}

export function parseJson(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function json(value) {
  return JSON.stringify(value || {});
}

export function actorFromContext(ctx) {
  return {
    id: ctx?.actor_id || ctx?.user_id || ctx?.created_by || ctx?.updated_by || 'demo-member',
    role: ctx?.actor_role || ctx?.role || 'member',
  };
}

export function isoNow() {
  return nowIso();
}
