import {
  loadDemoState,
  saveDemoState,
} from '../state/demoState';
import type {
  AdminOperation,
  Booking,
  BusinessResult,
  DemoState,
  DynamicDisablement,
  MergedRoom,
  Room,
  RoomId,
  RuleId,
  StructuredIntent,
  TimeRange,
  UnavailabilityRule,
  Weekday,
} from '../types';

export interface BusinessServiceOptions {
  filePath?: string;
}

export interface QueryAvailabilityInput {
  date: string;
  range?: TimeRange;
  roomIds?: RoomId[];
  roomNames?: string[];
  capacity?: number;
  includeMergedRooms?: boolean;
}

export interface CreateBookingInput {
  roomId: RoomId;
  sourceRoomIds?: RoomId[];
  title: string;
  date: string;
  range: TimeRange;
  organizer: StructuredIntent['entities'] extends infer Entities
    ? Entities extends { organizer?: infer Organizer }
      ? Organizer
      : never
    : never;
  attendees?: StructuredIntent['entities'] extends infer Entities
    ? Entities extends { attendees?: infer Attendees }
      ? Attendees
      : never
    : never;
  description?: string;
}

export interface CancelBookingInput {
  bookingId: string;
  reason?: string;
}

export interface DynamicDisableInput {
  roomId: RoomId;
  reason: string;
  startDate: string;
  endDate?: string;
  ranges: TimeRange[];
  active?: boolean;
}

export interface RuleInput {
  id?: RuleId;
  type: UnavailabilityRule['type'];
  scope: UnavailabilityRule['scope'];
  roomIds: RoomId[];
  title: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  weekdays?: UnavailabilityRule['weekdays'];
  ranges: TimeRange[];
  active?: boolean;
}

export interface MergeRoomsInput {
  sourceRoomIds: RoomId[];
  mergedRoomId?: RoomId;
  name?: string;
  location?: string;
  capacity?: number;
  equipment?: string[];
  date?: string;
}

export interface SplitMergedRoomInput {
  mergedRoomId: RoomId;
}

type ReservationOwner =
  | { kind: 'booking'; booking: Booking }
  | { kind: 'rule'; rule: UnavailabilityRule }
  | { kind: 'dynamic'; dynamic: DynamicDisablement };

interface AvailabilitySlot {
  roomId: RoomId;
  name: string;
  capacity?: number;
  status: 'active' | 'inactive';
  sourceRoomIds?: RoomId[];
  available: boolean;
  unavailableReasons: string[];
}

const DEFAULT_FILE_PATH = 'demo-state.json';
const DEFAULT_MERGED_ROOM_ID = 'meeting-room-1-2';
const SMALL_ROOM_IDS = new Set<RoomId>(['room-503', 'room-505', 'room-506']);

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTime(value: string): string {
  if (/^\d{1,2}:\d{2}$/.test(value)) {
    const [hourText, minuteText] = value.split(':');
    const hour = Number.parseInt(hourText, 10);
    const minute = Number.parseInt(minuteText, 10);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  if (/^\d{1,2}:\d{2}:\d{2}$/.test(value)) {
    const [hourText, minuteText] = value.split(':');
    const hour = Number.parseInt(hourText, 10);
    const minute = Number.parseInt(minuteText, 10);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  return value;
}

function timeToMinutes(time: string): number {
  const normalized = normalizeTime(time);
  if (normalized === '24:00') {
    return 24 * 60;
  }

  const [hourText, minuteText] = normalized.split(':');
  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  return hour * 60 + minute;
}

function normalizeRange(range: TimeRange): TimeRange {
  return {
    start: normalizeTime(range.start),
    end: normalizeTime(range.end),
  };
}

function assertValidRange(range: TimeRange): void {
  const normalized = normalizeRange(range);
  if (timeToMinutes(normalized.start) >= timeToMinutes(normalized.end)) {
    throw new Error(`时间段无效：${normalized.start}-${normalized.end}`);
  }
}

function rangesOverlap(left: TimeRange, right: TimeRange): boolean {
  const normalizedLeft = normalizeRange(left);
  const normalizedRight = normalizeRange(right);
  return timeToMinutes(normalizedLeft.start) < timeToMinutes(normalizedRight.end)
    && timeToMinutes(normalizedRight.start) < timeToMinutes(normalizedLeft.end);
}

function parseDate(date: string): Date {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`日期格式无效：${date}`);
  }

  return parsed;
}

function getWeekday(date: string): Weekday {
  return parseDate(date).getDay() as Weekday;
}

function isDateInRange(date: string, start?: string, end?: string): boolean {
  if (start && date < start) {
    return false;
  }

  if (end && date > end) {
    return false;
  }

  return true;
}

function isRuleActiveOnDate(rule: UnavailabilityRule, date: string): boolean {
  if (!rule.active) {
    return false;
  }

  if (!isDateInRange(date, rule.startDate, rule.endDate)) {
    return false;
  }

  if (rule.type === 'lunch') {
    return true;
  }

  if (rule.weekdays && rule.weekdays.length > 0 && !rule.weekdays.includes(getWeekday(date))) {
    return false;
  }

  return true;
}

function isDynamicActiveOnDate(dynamic: DynamicDisablement, date: string): boolean {
  if (!dynamic.active) {
    return false;
  }

  return isDateInRange(date, dynamic.startDate, dynamic.endDate);
}

function getRoomById(state: DemoState, roomId: RoomId): Room | undefined {
  return state.rooms.find((room) => room.id === roomId);
}

function getMergedRoomById(state: DemoState, mergedRoomId: RoomId): MergedRoom | undefined {
  return state.mergedRooms.find((room) => room.id === mergedRoomId);
}

function getBookingById(state: DemoState, bookingId: string): Booking | undefined {
  return state.bookings.find((booking) => booking.id === bookingId);
}

function getRuleById(state: DemoState, ruleId: RuleId): UnavailabilityRule | undefined {
  return state.unavailabilityRules.find((rule) => rule.id === ruleId);
}

function getRoomLabel(state: DemoState, roomId: RoomId): string {
  return getRoomById(state, roomId)?.name ?? getMergedRoomById(state, roomId)?.name ?? roomId;
}

function isSmallRoom(room: Room): boolean {
  return SMALL_ROOM_IDS.has(room.id) || Boolean(room.capacity && room.capacity <= 8);
}

function roomMatchesFilters(room: Room, input: QueryAvailabilityInput): boolean {
  if (input.roomIds && input.roomIds.length > 0 && !input.roomIds.includes(room.id)) {
    return false;
  }

  if (input.roomNames && input.roomNames.length > 0) {
    const normalizedNames = input.roomNames.map((name) => name.trim().toLowerCase());
    const exactMatch = normalizedNames.includes(room.name.toLowerCase());
    const wantsSmallRooms = normalizedNames.some((name) => ['小会议室', '小会议', '小型会议室', 'small room', 'small'].includes(name));
    const wantsNormalRooms = normalizedNames.some((name) => ['普通会议室', '普通', 'normal room', 'normal'].includes(name));

    if (!exactMatch && !(wantsSmallRooms && isSmallRoom(room)) && !wantsNormalRooms) {
      return false;
    }
  }

  if (input.capacity && room.capacity && room.capacity < input.capacity) {
    return false;
  }

  return true;
}

function mergedRoomMatchesFilters(mergedRoom: MergedRoom, input: QueryAvailabilityInput): boolean {
  if (input.roomIds && input.roomIds.length > 0 && !input.roomIds.includes(mergedRoom.id)) {
    return false;
  }

  if (input.roomNames && input.roomNames.length > 0) {
    const normalizedNames = input.roomNames.map((name) => name.trim().toLowerCase());
    const exactMatch = normalizedNames.includes(mergedRoom.name.toLowerCase());
    const wantsMergedRooms = normalizedNames.some((name) => ['合并', '合并会议室', '大会议室', 'merged room', 'merged'].includes(name));

    if (!exactMatch && !wantsMergedRooms) {
      return false;
    }
  }

  if (input.capacity && mergedRoom.capacity && mergedRoom.capacity < input.capacity) {
    return false;
  }

  return true;
}

function getBookingsBlockingRoom(state: DemoState, roomId: RoomId, date: string, range: TimeRange): Booking[] {
  return state.bookings.filter((booking) => {
    if (booking.status !== 'confirmed' || booking.date !== date || !rangesOverlap(booking.range, range)) {
      return false;
    }

    if (booking.roomId === roomId) {
      return true;
    }

    return Boolean(booking.sourceRoomIds?.includes(roomId));
  });
}

function getRulesBlockingRoom(state: DemoState, roomId: RoomId, date: string, range: TimeRange): UnavailabilityRule[] {
  return state.unavailabilityRules.filter((rule) => {
    if (!isRuleActiveOnDate(rule, date) || !rule.roomIds.includes(roomId)) {
      return false;
    }

    return rule.ranges.some((ruleRange) => rangesOverlap(ruleRange, range));
  });
}

function getDynamicDisablesBlockingRoom(state: DemoState, roomId: RoomId, date: string, range: TimeRange): DynamicDisablement[] {
  return state.dynamicDisables.filter((dynamic) => {
    if (!isDynamicActiveOnDate(dynamic, date) || dynamic.roomId !== roomId) {
      return false;
    }

    return dynamic.ranges.some((dynamicRange) => rangesOverlap(dynamicRange, range));
  });
}

function getOwnersBlockingRoom(state: DemoState, roomId: RoomId, date: string, range: TimeRange): ReservationOwner[] {
  const owners: ReservationOwner[] = [];

  owners.push(...getBookingsBlockingRoom(state, roomId, date, range).map((booking) => ({ kind: 'booking' as const, booking })));
  owners.push(...getRulesBlockingRoom(state, roomId, date, range).map((rule) => ({ kind: 'rule' as const, rule })));
  owners.push(...getDynamicDisablesBlockingRoom(state, roomId, date, range).map((dynamic) => ({ kind: 'dynamic' as const, dynamic })));

  return owners;
}

function getBookingsBlockingMergedRoom(state: DemoState, mergedRoom: MergedRoom, date: string, range: TimeRange): Booking[] {
  return state.bookings.filter((booking) => {
    if (booking.status !== 'confirmed' || booking.date !== date || !rangesOverlap(booking.range, range)) {
      return false;
    }

    if (booking.roomId === mergedRoom.id) {
      return true;
    }

    if (booking.sourceRoomIds && booking.sourceRoomIds.length > 0) {
      return booking.sourceRoomIds.some((sourceRoomId) => mergedRoom.sourceRoomIds.includes(sourceRoomId));
    }

    return mergedRoom.sourceRoomIds.includes(booking.roomId);
  });
}

function getRulesBlockingMergedRoom(state: DemoState, mergedRoom: MergedRoom, date: string, range: TimeRange): UnavailabilityRule[] {
  return state.unavailabilityRules.filter((rule) => {
    if (!isRuleActiveOnDate(rule, date)) {
      return false;
    }

    return rule.roomIds.some((roomId) => mergedRoom.sourceRoomIds.includes(roomId));
  }).filter((rule) => rule.ranges.some((ruleRange) => rangesOverlap(ruleRange, range)));
}

function getDynamicDisablesBlockingMergedRoom(state: DemoState, mergedRoom: MergedRoom, date: string, range: TimeRange): DynamicDisablement[] {
  return state.dynamicDisables.filter((dynamic) => {
    if (!isDynamicActiveOnDate(dynamic, date)) {
      return false;
    }

    return mergedRoom.sourceRoomIds.includes(dynamic.roomId);
  }).filter((dynamic) => dynamic.ranges.some((dynamicRange) => rangesOverlap(dynamicRange, range)));
}

function getOwnersBlockingMergedRoom(state: DemoState, mergedRoom: MergedRoom, date: string, range: TimeRange): ReservationOwner[] {
  const owners: ReservationOwner[] = [];

  owners.push(...getBookingsBlockingMergedRoom(state, mergedRoom, date, range).map((booking) => ({ kind: 'booking' as const, booking })));
  owners.push(...getRulesBlockingMergedRoom(state, mergedRoom, date, range).map((rule) => ({ kind: 'rule' as const, rule })));
  owners.push(...getDynamicDisablesBlockingMergedRoom(state, mergedRoom, date, range).map((dynamic) => ({ kind: 'dynamic' as const, dynamic })));

  return owners;
}

function describeBookingConflict(booking: Booking, state: DemoState): string {
  if (booking.roomId !== booking.roomId && booking.sourceRoomIds) {
    return `合并预约 ${booking.id}（${booking.title}）占用 ${booking.sourceRoomIds.map((roomId) => getRoomLabel(state, roomId)).join(' / ')}`;
  }

  const mergedRoom = getMergedRoomById(state, booking.roomId);
  if (mergedRoom) {
    return `合并预约 ${booking.id}（${booking.title}）占用 ${mergedRoom.name}`;
  }

  return `已有预约 ${booking.id}（${booking.title}）`;
}

function describeRuleConflict(rule: UnavailabilityRule): string {
  const typeText: Record<UnavailabilityRule['type'], string> = {
    lunch: '午餐规则',
    weeklyUnavailable: '每周不可用规则',
    temporaryMaintenance: '临时维护规则',
    adminRule: '管理员规则',
    mergedRoomBlock: '合并会议室占用规则',
  };

  return `${typeText[rule.type]} ${rule.id}（${rule.title}）`;
}

function describeDynamicConflict(dynamic: DynamicDisablement): string {
  return `动态禁用 ${dynamic.id}（${dynamic.reason}）`;
}

function getConflictMessages(owners: ReservationOwner[], state: DemoState): string[] {
  return owners.map((owner) => {
    switch (owner.kind) {
      case 'booking':
        return describeBookingConflict(owner.booking, state);
      case 'rule':
        return describeRuleConflict(owner.rule);
      case 'dynamic':
        return describeDynamicConflict(owner.dynamic);
      default:
        return '未知占用';
    }
  });
}

function buildResult(status: BusinessResult['status'], message: string, data?: unknown): BusinessResult {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status,
    message,
    data: data ?? {},
    createdAt: nowIso(),
  };
}

function appendBusinessResult(state: DemoState, result: BusinessResult): void {
  state.businessResults.push(result);
}

function appendAdminOperation(
  state: DemoState,
  input: Pick<AdminOperation, 'type' | 'actor' | 'targetId' | 'summary' | 'details'>,
): void {
  state.adminOperations.push({
    id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: nowIso(),
    ...input,
  });
}

function upsertRoom(state: DemoState, room: Room): void {
  const index = state.rooms.findIndex((existingRoom) => existingRoom.id === room.id);
  if (index >= 0) {
    state.rooms[index] = {
      ...state.rooms[index],
      ...room,
    };
    return;
  }

  state.rooms.push(room);
}

function upsertMergedRoom(state: DemoState, mergedRoom: MergedRoom): void {
  const index = state.mergedRooms.findIndex((existingRoom) => existingRoom.id === mergedRoom.id);
  if (index >= 0) {
    state.mergedRooms[index] = {
      ...state.mergedRooms[index],
      ...mergedRoom,
    };
    return;
  }

  state.mergedRooms.push(mergedRoom);
}

function removeMergedRoom(state: DemoState, mergedRoomId: RoomId): void {
  state.mergedRooms = state.mergedRooms.filter((room) => room.id !== mergedRoomId);
}

function validateRoomIdsExist(state: DemoState, roomIds: RoomId[]): BusinessResult | undefined {
  const missingRoomIds = roomIds.filter((roomId) => !getRoomById(state, roomId) && !getMergedRoomById(state, roomId));
  if (missingRoomIds.length > 0) {
    return buildResult('notFound', `存在不存在的会议室：${missingRoomIds.join(', ')}`);
  }

  return undefined;
}

function normalizeRuleRanges(ranges: TimeRange[]): TimeRange[] {
  return ranges.map(normalizeRange);
}

function validateDateRange(startDate?: string, endDate?: string): BusinessResult | undefined {
  if (!startDate || !endDate) {
    return undefined;
  }

  try {
    parseDate(startDate);
    parseDate(endDate);
  } catch (error) {
    return buildResult('failed', error instanceof Error ? error.message : '日期范围无效。');
  }

  if (startDate > endDate) {
    return buildResult('failed', `日期范围无效：${startDate}-${endDate}`);
  }

  return undefined;
}

function createMergedBlockRuleId(mergedRoomId: RoomId, date?: string): string {
  return `merged-block-${mergedRoomId}-${date ?? 'all-dates'}`;
}

function createRule(state: DemoState, input: RuleInput, actor: string): BusinessResult {
  const notFound = validateRoomIdsExist(state, input.roomIds);
  if (notFound) {
    return notFound;
  }

  if (input.roomIds.length === 0) {
    return buildResult('failed', '新增规则必须指定会议室。');
  }

  const normalizedRanges = normalizeRuleRanges(input.ranges);
  if (normalizedRanges.length === 0) {
    return buildResult('failed', '新增规则必须指定不可预约时段。');
  }

  for (const range of normalizedRanges) {
    try {
      assertValidRange(range);
    } catch (error) {
      return buildResult('failed', error instanceof Error ? error.message : '规则时段无效。');
    }
  }

  const dateRangeError = validateDateRange(input.startDate, input.endDate);
  if (dateRangeError) {
    return dateRangeError;
  }

  const existingRule = input.id ? getRuleById(state, input.id) : undefined;
  if (existingRule) {
    return buildResult('failed', `规则已存在：${input.id}`);
  }

  const now = nowIso();
  const rule: UnavailabilityRule = {
    id: input.id ?? `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: input.type,
    scope: input.scope,
    roomIds: [...new Set(input.roomIds)],
    title: input.title,
    description: input.description,
    startDate: input.startDate,
    endDate: input.endDate,
    weekdays: input.weekdays,
    ranges: normalizedRanges,
    active: input.active ?? true,
    createdAt: now,
    updatedAt: now,
  };

  state.unavailabilityRules.push(rule);
  appendAdminOperation(state, {
    type: 'createRule',
    actor,
    targetId: rule.id,
    summary: `新增不可预约规则：${rule.title}`,
    details: rule,
  });

  const result = buildResult('success', `已新增不可预约规则：${rule.title}`, { rule });
  appendBusinessResult(state, result);
  return result;
}

function updateRule(state: DemoState, ruleId: RuleId, input: Partial<RuleInput>, actor: string): BusinessResult {
  const rule = getRuleById(state, ruleId);
  if (!rule) {
    const result = buildResult('notFound', `未找到规则：${ruleId}`);
    appendBusinessResult(state, result);
    return result;
  }

  const nextRoomIds = input.roomIds ? input.roomIds : rule.roomIds;
  const notFound = validateRoomIdsExist(state, nextRoomIds);
  if (notFound) {
    appendBusinessResult(state, notFound);
    return notFound;
  }

  const nextRanges = input.ranges ? normalizeRuleRanges(input.ranges) : rule.ranges;
  if (nextRanges.length === 0) {
    const result = buildResult('failed', '更新规则必须保留至少一个不可预约时段。');
    appendBusinessResult(state, result);
    return result;
  }

  for (const range of nextRanges) {
    try {
      assertValidRange(range);
    } catch (error) {
      const result = buildResult('failed', error instanceof Error ? error.message : '规则时段无效。');
      appendBusinessResult(state, result);
      return result;
    }
  }

  const nextStartDate = input.startDate ?? rule.startDate;
  const nextEndDate = input.endDate ?? rule.endDate;
  const dateRangeError = validateDateRange(nextStartDate, nextEndDate);
  if (dateRangeError) {
    appendBusinessResult(state, dateRangeError);
    return dateRangeError;
  }

  const nextRule: UnavailabilityRule = {
    ...rule,
    ...input,
    roomIds: [...new Set(nextRoomIds)],
    ranges: nextRanges,
    startDate: nextStartDate,
    endDate: nextEndDate,
    active: input.active ?? rule.active,
    updatedAt: nowIso(),
  };

  const index = state.unavailabilityRules.findIndex((existingRule) => existingRule.id === ruleId);
  state.unavailabilityRules[index] = nextRule;

  appendAdminOperation(state, {
    type: 'updateRule',
    actor,
    targetId: ruleId,
    summary: `更新不可预约规则：${nextRule.title}`,
    details: nextRule,
  });

  const result = buildResult('success', `已更新不可预约规则：${nextRule.title}`, { rule: nextRule });
  appendBusinessResult(state, result);
  return result;
}

function deleteRule(state: DemoState, ruleId: RuleId, actor: string): BusinessResult {
  const rule = getRuleById(state, ruleId);
  if (!rule) {
    const result = buildResult('notFound', `未找到规则：${ruleId}`);
    appendBusinessResult(state, result);
    return result;
  }

  state.unavailabilityRules = state.unavailabilityRules.filter((existingRule) => existingRule.id !== ruleId);
  appendAdminOperation(state, {
    type: 'deleteRule',
    actor,
    targetId: ruleId,
    summary: `删除不可预约规则：${rule.title}`,
    details: rule,
  });

  const result = buildResult('success', `已删除不可预约规则：${rule.title}`, { ruleId });
  appendBusinessResult(state, result);
  return result;
}

function dynamicDisable(state: DemoState, input: DynamicDisableInput, actor: string): BusinessResult {
  const room = getRoomById(state, input.roomId) ?? getMergedRoomById(state, input.roomId);
  if (!room) {
    const result = buildResult('notFound', `未找到会议室：${input.roomId}`);
    appendBusinessResult(state, result);
    return result;
  }

  const normalizedRanges = normalizeRuleRanges(input.ranges.length > 0 ? input.ranges : [{ start: '00:00', end: '24:00' }]);
  if (normalizedRanges.length === 0) {
    const result = buildResult('failed', '动态禁用必须指定不可预约时段。');
    appendBusinessResult(state, result);
    return result;
  }

  for (const range of normalizedRanges) {
    try {
      assertValidRange(range);
    } catch (error) {
      const result = buildResult('failed', error instanceof Error ? error.message : '禁用时段无效。');
      appendBusinessResult(state, result);
      return result;
    }
  }

  const dateRangeError = validateDateRange(input.startDate, input.endDate);
  if (dateRangeError) {
    appendBusinessResult(state, dateRangeError);
    return dateRangeError;
  }

  const now = nowIso();
  const existingDynamic = state.dynamicDisables.find((dynamic) => (
    dynamic.active
      && dynamic.roomId === input.roomId
      && dynamic.startDate === input.startDate
      && dynamic.endDate === input.endDate
      && dynamic.reason === input.reason
  ));

  if (existingDynamic) {
    existingDynamic.ranges = normalizedRanges;
    existingDynamic.active = input.active ?? true;
    existingDynamic.updatedAt = now;
    appendAdminOperation(state, {
      type: 'dynamicDisable',
      actor,
      targetId: input.roomId,
      summary: `更新动态禁用会议室：${room.name}`,
      details: existingDynamic,
    });

    const result = buildResult('success', `已更新动态禁用会议室：${room.name}`, { dynamic: existingDynamic });
    appendBusinessResult(state, result);
    return result;
  }

  const dynamic: DynamicDisablement = {
    id: `disable-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    roomId: input.roomId,
    reason: input.reason,
    startDate: input.startDate,
    endDate: input.endDate,
    ranges: normalizedRanges,
    active: input.active ?? true,
    createdAt: now,
    updatedAt: now,
  };

  state.dynamicDisables.push(dynamic);
  appendAdminOperation(state, {
    type: 'dynamicDisable',
    actor,
    targetId: input.roomId,
    summary: `动态禁用会议室：${room.name}`,
    details: dynamic,
  });

  const result = buildResult('success', `已动态禁用会议室：${room.name}`, { dynamic });
  appendBusinessResult(state, result);
  return result;
}

function dynamicEnable(state: DemoState, roomId: RoomId, reason?: string, actor: string = 'admin'): BusinessResult {
  const room = getRoomById(state, roomId) ?? getMergedRoomById(state, roomId);
  if (!room) {
    const result = buildResult('notFound', `未找到会议室：${roomId}`);
    appendBusinessResult(state, result);
    return result;
  }

  const now = nowIso();
  const disabled = state.dynamicDisables.filter((dynamic) => dynamic.roomId === roomId && dynamic.active);
  disabled.forEach((dynamic) => {
    dynamic.active = false;
    dynamic.updatedAt = now;
  });

  appendAdminOperation(state, {
    type: 'dynamicEnable',
    actor,
    targetId: roomId,
    summary: `动态启用会议室：${room.name}`,
    details: { disabledCount: disabled.length, reason },
  });

  const result = buildResult('success', `已动态启用会议室：${room.name}`, { roomId, disabledCount: disabled.length });
  appendBusinessResult(state, result);
  return result;
}

function disableRoom(state: DemoState, input: DynamicDisableInput, actor: string = 'admin'): BusinessResult {
  return dynamicDisable(state, input, actor);
}

function enableRoom(state: DemoState, roomId: RoomId, reason?: string, actor: string = 'admin'): BusinessResult {
  return dynamicEnable(state, roomId, reason, actor);
}

function canMergeRooms(sourceRooms: Room[]): boolean {
  if (sourceRooms.length !== 2) {
    return false;
  }

  const [left, right] = sourceRooms;
  const ids = new Set([left.id, right.id]);
  const isDefaultMeetingPair = ids.has('meeting-room-1') && ids.has('meeting-room-2');

  return isDefaultMeetingPair
    || Boolean(left.canMergeWith?.includes(right.id) && right.canMergeWith?.includes(left.id));
}

function mergeRooms(state: DemoState, roomIdsOrInput: RoomId[] | MergeRoomsInput, range?: TimeRange, actor: string = 'admin'): BusinessResult {
  const input: MergeRoomsInput = Array.isArray(roomIdsOrInput)
    ? { sourceRoomIds: roomIdsOrInput }
    : { ...roomIdsOrInput, sourceRoomIds: roomIdsOrInput.sourceRoomIds ?? [] };

  if (input.sourceRoomIds.length < 2) {
    const result = buildResult('failed', '合并会议室至少需要两个源会议室。');
    appendBusinessResult(state, result);
    return result;
  }

  const sourceRooms = input.sourceRoomIds.map((roomId) => getRoomById(state, roomId));
  if (sourceRooms.some((room) => !room)) {
    const result = buildResult('notFound', `存在不存在的源会议室：${input.sourceRoomIds.join(', ')}`);
    appendBusinessResult(state, result);
    return result;
  }

  const validSourceRooms = sourceRooms.filter(Boolean) as Room[];
  if (!canMergeRooms(validSourceRooms)) {
    const result = buildResult('failed', `这些会议室不能合并：${input.sourceRoomIds.join(', ')}`);
    appendBusinessResult(state, result);
    return result;
  }

  if (range) {
    try {
      assertValidRange(range);
    } catch (error) {
      const result = buildResult('failed', error instanceof Error ? error.message : '合并时段无效。');
      appendBusinessResult(state, result);
      return result;
    }
  }

  const mergedRoomId = input.mergedRoomId ?? DEFAULT_MERGED_ROOM_ID;
  const mergedRoomName = input.name ?? '会议室一/二合并';
  const existingMergedRoom = getMergedRoomById(state, mergedRoomId);
  const mergedRoom: MergedRoom = {
    id: mergedRoomId,
    name: mergedRoomName,
    location: input.location ?? existingMergedRoom?.location,
    capacity: input.capacity ?? existingMergedRoom?.capacity ?? validSourceRooms.reduce((sum, room) => sum + (room.capacity ?? 0), 0),
    equipment: input.equipment ?? existingMergedRoom?.equipment ?? [...new Set(validSourceRooms.flatMap((room) => room.equipment ?? []))],
    status: 'active',
    sourceRoomIds: [...input.sourceRoomIds],
    mergedRoomId,
    canMergeWith: input.sourceRoomIds,
  };

  upsertMergedRoom(state, mergedRoom);

  if (range && input.date) {
    const blockRule: UnavailabilityRule = {
      id: createMergedBlockRuleId(mergedRoomId, input.date),
      type: 'mergedRoomBlock',
      scope: 'roomGroup',
      roomIds: [...input.sourceRoomIds],
      title: `${mergedRoomName}占用`,
      description: `${mergedRoomName}在 ${input.date} ${range.start}-${range.end} 占用，源会议室不可单独预约。`,
      startDate: input.date,
      endDate: input.date,
      ranges: [normalizeRange(range)],
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const existingBlockRule = getRuleById(state, blockRule.id);
    if (existingBlockRule) {
      const index = state.unavailabilityRules.findIndex((rule) => rule.id === blockRule.id);
      state.unavailabilityRules[index] = {
        ...existingBlockRule,
        ...blockRule,
        updatedAt: nowIso(),
      };
    } else {
      state.unavailabilityRules.push(blockRule);
    }
  }

  appendAdminOperation(state, {
    type: 'createRoom',
    actor,
    targetId: mergedRoomId,
    summary: `合并会议室：${mergedRoom.name}`,
    details: mergedRoom,
  });

  const result = buildResult('success', `已合并会议室：${mergedRoom.name}`, { mergedRoom, range });
  appendBusinessResult(state, result);
  return result;
}

function unmergeRooms(state: DemoState, mergedRoomIdOrInput: RoomId | SplitMergedRoomInput, actor: string = 'admin'): BusinessResult {
  const mergedRoomId = typeof mergedRoomIdOrInput === 'string' ? mergedRoomIdOrInput : mergedRoomIdOrInput.mergedRoomId;
  const mergedRoom = getMergedRoomById(state, mergedRoomId);
  if (!mergedRoom) {
    const result = buildResult('notFound', `未找到合并会议室：${mergedRoomId}`);
    appendBusinessResult(state, result);
    return result;
  }

  const blockRuleIds = new Set<string>(
    state.unavailabilityRules
      .filter((rule) => rule.type === 'mergedRoomBlock' && rule.roomIds.every((roomId) => mergedRoom.sourceRoomIds.includes(roomId)))
      .map((rule) => rule.id),
  );

  state.unavailabilityRules = state.unavailabilityRules.filter((rule) => !blockRuleIds.has(rule.id));
  removeMergedRoom(state, mergedRoomId);

  appendAdminOperation(state, {
    type: 'updateRule',
    actor,
    targetId: mergedRoomId,
    summary: `拆分合并会议室：${mergedRoom.name}`,
    details: { mergedRoom, removedRuleIds: [...blockRuleIds] },
  });

  const result = buildResult('success', `已拆分合并会议室：${mergedRoom.name}`, { mergedRoomId, removedRuleIds: [...blockRuleIds] });
  appendBusinessResult(state, result);
  return result;
}

function listAvailableRooms(state: DemoState, input: QueryAvailabilityInput): BusinessResult {
  let normalizedRange: TimeRange | undefined;
  if (input.range) {
    normalizedRange = normalizeRange(input.range);
    try {
      assertValidRange(normalizedRange);
    } catch (error) {
      const result = buildResult('failed', error instanceof Error ? error.message : '时间段无效。');
      appendBusinessResult(state, result);
      return result;
    }
  }

  try {
    parseDate(input.date);
  } catch (error) {
    const result = buildResult('failed', error instanceof Error ? error.message : '日期无效。');
    appendBusinessResult(state, result);
    return result;
  }

  const slots: AvailabilitySlot[] = [];

  state.rooms.forEach((room) => {
    if (!roomMatchesFilters(room, input)) {
      return;
    }

    const conflicts = normalizedRange ? getOwnersBlockingRoom(state, room.id, input.date, normalizedRange) : [];
    const unavailableReasons = room.status === 'inactive'
      ? ['会议室状态不可用']
      : getConflictMessages(conflicts, state);

    slots.push({
      roomId: room.id,
      name: room.name,
      capacity: room.capacity,
      status: room.status,
      available: room.status === 'active' && conflicts.length === 0,
      unavailableReasons,
    });
  });

  if (input.includeMergedRooms !== false) {
    state.mergedRooms.forEach((mergedRoom) => {
      if (!mergedRoomMatchesFilters(mergedRoom, input)) {
        return;
      }

      const conflicts = normalizedRange ? getOwnersBlockingMergedRoom(state, mergedRoom, input.date, normalizedRange) : [];
      const unavailableReasons = mergedRoom.status === 'inactive'
        ? ['合并会议室状态不可用']
        : getConflictMessages(conflicts, state);

      slots.push({
        roomId: mergedRoom.id,
        name: mergedRoom.name,
        capacity: mergedRoom.capacity,
        status: mergedRoom.status,
        sourceRoomIds: mergedRoom.sourceRoomIds,
        available: mergedRoom.status === 'active' && conflicts.length === 0,
        unavailableReasons,
      });
    });
  }

  const available = slots.filter((slot) => slot.available);
  const unavailable = slots.filter((slot) => !slot.available);
  const result = buildResult('success', '已查询可预约资源。', {
    date: input.date,
    range: normalizedRange,
    available,
    availableRooms: available,
    unavailable,
    all: slots,
  });
  appendBusinessResult(state, result);
  return result;
}

function queryAvailability(state: DemoState, input: QueryAvailabilityInput): BusinessResult {
  return listAvailableRooms(state, input);
}

function createBooking(state: DemoState, input: CreateBookingInput, actor: string = 'member'): BusinessResult {
  const room = getRoomById(state, input.roomId);
  const mergedRoom = getMergedRoomById(state, input.roomId);
  if (!room && !mergedRoom) {
    const result = buildResult('notFound', `未找到会议室：${input.roomId}`);
    appendBusinessResult(state, result);
    return result;
  }

  if (!input.organizer || typeof input.organizer.name !== 'string' || input.organizer.name.trim() === '') {
    const result = buildResult('failed', '创建预约必须提供组织者。');
    appendBusinessResult(state, result);
    return result;
  }

  let normalizedRange: TimeRange;
  try {
    normalizedRange = normalizeRange(input.range);
    assertValidRange(normalizedRange);
    parseDate(input.date);
  } catch (error) {
    const result = buildResult('failed', error instanceof Error ? error.message : '预约时间无效。');
    appendBusinessResult(state, result);
    return result;
  }

  const owners = mergedRoom
    ? getOwnersBlockingMergedRoom(state, mergedRoom, input.date, normalizedRange)
    : getOwnersBlockingRoom(state, input.roomId, input.date, normalizedRange);
  const conflicts = getConflictMessages(owners, state);

  if (conflicts.length > 0) {
    const result = buildResult('conflict', `预约冲突：${conflicts.join('；')}`, {
      roomId: input.roomId,
      date: input.date,
      range: normalizedRange,
      conflicts,
    });
    appendBusinessResult(state, result);
    return result;
  }

  const now = nowIso();
  const booking: Booking = {
    id: `booking-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    roomId: input.roomId,
    sourceRoomIds: mergedRoom ? mergedRoom.sourceRoomIds : input.sourceRoomIds,
    title: input.title,
    description: input.description,
    organizer: input.organizer,
    attendees: input.attendees,
    date: input.date,
    range: normalizedRange,
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  };

  state.bookings.push(booking);
  appendAdminOperation(state, {
    type: 'forceAdjustBooking',
    actor,
    targetId: booking.id,
    summary: `创建预约：${booking.title}`,
    details: booking,
  });

  const result = buildResult('success', `已创建预约：${booking.title}`, { booking });
  appendBusinessResult(state, result);
  return result;
}

function cancelBooking(state: DemoState, bookingId: string, actor: string = 'member'): BusinessResult {
  const booking = getBookingById(state, bookingId);
  if (!booking) {
    const result = buildResult('notFound', `未找到预约：${bookingId}`);
    appendBusinessResult(state, result);
    return result;
  }

  if (booking.status === 'cancelled') {
    const result = buildResult('failed', `预约已取消：${bookingId}`);
    appendBusinessResult(state, result);
    return result;
  }

  const now = nowIso();
  booking.status = 'cancelled';
  booking.updatedAt = now;
  booking.cancelledAt = now;
  booking.rejectionReason = actor === 'member' ? '用户取消' : undefined;

  appendAdminOperation(state, {
    type: 'cancelBooking',
    actor,
    targetId: booking.id,
    summary: `取消预约：${booking.title}`,
    details: booking,
  });

  const result = buildResult('success', `已取消预约：${booking.title}`, { bookingId: booking.id });
  appendBusinessResult(state, result);
  return result;
}

function createRoom(state: DemoState, room: Room, actor: string = 'admin'): BusinessResult {
  if (getRoomById(state, room.id)) {
    const result = buildResult('failed', `会议室已存在：${room.id}`);
    appendBusinessResult(state, result);
    return result;
  }

  upsertRoom(state, room);
  appendAdminOperation(state, {
    type: 'createRoom',
    actor,
    targetId: room.id,
    summary: `新增会议室：${room.name}`,
    details: room,
  });

  const result = buildResult('success', `已新增会议室：${room.name}`, { room });
  appendBusinessResult(state, result);
  return result;
}

function updateRoom(state: DemoState, roomId: RoomId, patch: Partial<Room>, actor: string = 'admin'): BusinessResult {
  const room = getRoomById(state, roomId);
  if (!room) {
    const result = buildResult('notFound', `未找到会议室：${roomId}`);
    appendBusinessResult(state, result);
    return result;
  }

  const nextRoom: Room = {
    ...room,
    ...patch,
    id: roomId,
  };

  const index = state.rooms.findIndex((existingRoom) => existingRoom.id === roomId);
  state.rooms[index] = nextRoom;

  appendAdminOperation(state, {
    type: 'updateRoom',
    actor,
    targetId: roomId,
    summary: `更新会议室：${nextRoom.name}`,
    details: nextRoom,
  });

  const result = buildResult('success', `已更新会议室：${nextRoom.name}`, { room: nextRoom });
  appendBusinessResult(state, result);
  return result;
}

function deleteRoom(state: DemoState, roomId: RoomId, actor: string = 'admin'): BusinessResult {
  const room = getRoomById(state, roomId);
  if (!room) {
    const result = buildResult('notFound', `未找到会议室：${roomId}`);
    appendBusinessResult(state, result);
    return result;
  }

  state.rooms = state.rooms.filter((existingRoom) => existingRoom.id !== roomId);
  state.mergedRooms = state.mergedRooms
    .map((mergedRoom) => ({
      ...mergedRoom,
      sourceRoomIds: mergedRoom.sourceRoomIds.filter((sourceRoomId) => sourceRoomId !== roomId),
    }))
    .filter((mergedRoom) => mergedRoom.sourceRoomIds.length > 0);
  state.dynamicDisables = state.dynamicDisables.filter((dynamic) => dynamic.roomId !== roomId);
  state.unavailabilityRules = state.unavailabilityRules.filter((rule) => !rule.roomIds.includes(roomId));

  appendAdminOperation(state, {
    type: 'updateRoom',
    actor,
    targetId: roomId,
    summary: `删除会议室：${room.name}`,
    details: room,
  });

  const result = buildResult('success', `已删除会议室：${room.name}`, { roomId });
  appendBusinessResult(state, result);
  return result;
}

export class MeetingBusinessService {
  private readonly filePath: string;

  constructor(options: BusinessServiceOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_FILE_PATH;
  }

  listAvailableRooms(input: QueryAvailabilityInput): BusinessResult {
    const state = loadDemoState(this.filePath);
    const result = listAvailableRooms(state, input);
    saveDemoState(state, this.filePath);
    return result;
  }

  queryAvailability(input: QueryAvailabilityInput): BusinessResult {
    return this.listAvailableRooms(input);
  }

  createBooking(input: CreateBookingInput, actor: string = 'member'): BusinessResult {
    const state = loadDemoState(this.filePath);
    const result = createBooking(state, input, actor);
    saveDemoState(state, this.filePath);
    return result;
  }

  cancelBooking(inputOrBookingId: string | CancelBookingInput, actor: string = 'member'): BusinessResult {
    const state = loadDemoState(this.filePath);
    const bookingId = typeof inputOrBookingId === 'string' ? inputOrBookingId : inputOrBookingId.bookingId;
    const reason = typeof inputOrBookingId === 'string' ? undefined : inputOrBookingId.reason;
    const result = cancelBooking(state, bookingId, actor);
    if (reason && result.status === 'success') {
      const booking = getBookingById(state, bookingId);
      result.data = { ...(result.data as Record<string, unknown>), reason, booking };
    }
    saveDemoState(state, this.filePath);
    return result;
  }

  dynamicDisable(input: DynamicDisableInput, actor: string = 'admin'): BusinessResult {
    const state = loadDemoState(this.filePath);
    const result = dynamicDisable(state, input, actor);
    saveDemoState(state, this.filePath);
    return result;
  }

  dynamicEnable(roomId: RoomId, reasonOrActor?: string, maybeActor?: string): BusinessResult {
    const state = loadDemoState(this.filePath);
    const actor = maybeActor ?? 'admin';
    const reason = maybeActor ? reasonOrActor : undefined;
    const result = dynamicEnable(state, roomId, reason, actor);
    saveDemoState(state, this.filePath);
    return result;
  }

  createRule(input: RuleInput, actor: string = 'admin'): BusinessResult {
    const state = loadDemoState(this.filePath);
    const result = createRule(state, input, actor);
    saveDemoState(state, this.filePath);
    return result;
  }

  updateRule(ruleId: RuleId, input: Partial<RuleInput>, actor: string = 'admin'): BusinessResult {
    const state = loadDemoState(this.filePath);
    const result = updateRule(state, ruleId, input, actor);
    saveDemoState(state, this.filePath);
    return result;
  }

  deleteRule(ruleId: RuleId, actor: string = 'admin'): BusinessResult {
    const state = loadDemoState(this.filePath);
    const result = deleteRule(state, ruleId, actor);
    saveDemoState(state, this.filePath);
    return result;
  }

  mergeRooms(input: MergeRoomsInput, actor: string = 'admin'): BusinessResult {
    const state = loadDemoState(this.filePath);
    const result = mergeRooms(state, input, undefined, actor);
    saveDemoState(state, this.filePath);
    return result;
  }

  unmergeRooms(input: SplitMergedRoomInput, actor: string = 'admin'): BusinessResult {
    const state = loadDemoState(this.filePath);
    const result = unmergeRooms(state, input, actor);
    saveDemoState(state, this.filePath);
    return result;
  }

  createRoom(room: Room, actor: string = 'admin'): BusinessResult {
    const state = loadDemoState(this.filePath);
    const result = createRoom(state, room, actor);
    saveDemoState(state, this.filePath);
    return result;
  }

  updateRoom(roomId: RoomId, patch: Partial<Room>, actor: string = 'admin'): BusinessResult {
    const state = loadDemoState(this.filePath);
    const result = updateRoom(state, roomId, patch, actor);
    saveDemoState(state, this.filePath);
    return result;
  }

  deleteRoom(roomId: RoomId, actor: string = 'admin'): BusinessResult {
    const state = loadDemoState(this.filePath);
    const result = deleteRoom(state, roomId, actor);
    saveDemoState(state, this.filePath);
    return result;
  }

  executeBusinessIntent(intent: StructuredIntent): BusinessResult {
    const state = loadDemoState(this.filePath);
    const result = executeBusinessIntent(state, intent);
    saveDemoState(state, this.filePath);
    return result;
  }
}

export const meetingBusinessService = new MeetingBusinessService();

export function executeBusinessIntent(state: DemoState, intent: StructuredIntent): BusinessResult {
  switch (intent.action) {
    case 'queryAvailability':
      return listAvailableRooms(state, {
        date: intent.entities?.date ?? new Date().toISOString().slice(0, 10),
        range: intent.entities?.range,
        roomIds: intent.entities?.roomIds,
        roomNames: intent.entities?.roomNames,
        capacity: intent.entities?.capacity,
        includeMergedRooms: intent.constraints?.includeMergedRooms as boolean | undefined,
      });
    case 'createBooking':
      return createBooking(state, {
        roomId: intent.entities?.roomIds?.[0] ?? '',
        sourceRoomIds: intent.constraints?.sourceRoomIds as RoomId[] | undefined,
        title: intent.entities?.title ?? '未命名预约',
        date: intent.entities?.date ?? new Date().toISOString().slice(0, 10),
        range: intent.entities?.range ?? { start: '09:00', end: '10:00' },
        organizer: intent.entities?.organizer ?? { name: 'member' },
        attendees: intent.entities?.attendees,
        description: intent.rawText,
      }, intent.actorRole);
    case 'cancelBooking':
      return cancelBooking(state, intent.entities?.bookingId ?? '', intent.actorRole);
    case 'dynamicDisableRoom':
      return dynamicDisable(state, {
        roomId: intent.entities?.roomIds?.[0] ?? '',
        reason: intent.entities?.reason ?? '管理员动态禁用',
        startDate: intent.entities?.date ?? new Date().toISOString().slice(0, 10),
        ranges: intent.entities?.range ? [intent.entities.range] : [{ start: '00:00', end: '24:00' }],
      }, intent.actorRole);
    case 'dynamicEnableRoom':
      return dynamicEnable(state, intent.entities?.roomIds?.[0] ?? '', undefined, intent.actorRole);
    case 'configureRule':
      return createRule(state, {
        type: intent.constraints?.ruleType as UnavailabilityRule['type'] ?? 'adminRule',
        scope: intent.constraints?.ruleScope as UnavailabilityRule['scope'] ?? 'room',
        roomIds: intent.entities?.roomIds ?? [],
        title: intent.entities?.title ?? '管理员规则',
        description: intent.rawText,
        startDate: intent.entities?.date,
        weekdays: intent.constraints?.weekdays as UnavailabilityRule['weekdays'] | undefined,
        ranges: intent.entities?.range ? [intent.entities.range] : [{ start: '00:00', end: '24:00' }],
        active: true,
      }, intent.actorRole);
    case 'updateRule':
      return updateRule(state, intent.entities?.ruleId ?? '', {
        type: intent.constraints?.ruleType as UnavailabilityRule['type'] | undefined,
        scope: intent.constraints?.ruleScope as UnavailabilityRule['scope'] | undefined,
        roomIds: intent.entities?.roomIds,
        title: intent.entities?.title,
        description: intent.rawText,
        startDate: intent.entities?.date,
        weekdays: intent.constraints?.weekdays as UnavailabilityRule['weekdays'] | undefined,
        ranges: intent.entities?.range ? [intent.entities.range] : undefined,
        active: intent.constraints?.active as boolean | undefined,
      }, intent.actorRole);
    case 'deleteRule':
      return deleteRule(state, intent.entities?.ruleId ?? '', intent.actorRole);
    case 'mergeRooms': {
      const mergeSourceRoomIds = intent.entities?.roomIds?.length
        ? intent.entities.roomIds
        : Array.isArray(intent.constraints?.sourceRoomIds) ? intent.constraints.sourceRoomIds as RoomId[] : [];
      return mergeRooms(state, {
        sourceRoomIds: mergeSourceRoomIds,
        mergedRoomId: intent.constraints?.mergedRoomId as RoomId | undefined,
        name: intent.entities?.title ?? '合并会议室',
        location: intent.entities?.location,
        capacity: intent.entities?.capacity,
        equipment: intent.entities?.equipment,
        date: intent.entities?.date,
      }, intent.entities?.range, intent.actorRole);
    }
    case 'unmergeRooms':
      return unmergeRooms(state, {
        mergedRoomId: intent.entities?.roomIds?.[0] ?? DEFAULT_MERGED_ROOM_ID,
      }, intent.actorRole);
    case 'adjustBooking':
      return createBooking(state, {
        roomId: intent.entities?.roomIds?.[0] ?? '',
        sourceRoomIds: intent.constraints?.sourceRoomIds as RoomId[] | undefined,
        title: intent.entities?.title ?? '调整后预约',
        date: intent.entities?.date ?? new Date().toISOString().slice(0, 10),
        range: intent.entities?.range ?? { start: '09:00', end: '10:00' },
        organizer: intent.entities?.organizer ?? { name: 'admin' },
        attendees: intent.entities?.attendees,
        description: intent.rawText,
      }, intent.actorRole);
    case 'configureRoom': {
      const roomId = intent.entities?.roomIds?.[0] ?? `room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const existingRoom = getRoomById(state, roomId);
      if (existingRoom) {
        return updateRoom(state, roomId, {
          name: intent.entities?.roomNames?.[0] ?? existingRoom.name,
          location: intent.entities?.location ?? existingRoom.location,
          capacity: intent.entities?.capacity ?? existingRoom.capacity,
          equipment: intent.entities?.equipment ?? existingRoom.equipment,
          status: intent.constraints?.status as Room['status'] ?? existingRoom.status,
        }, intent.actorRole);
      }

      return createRoom(state, {
        id: roomId,
        name: intent.entities?.roomNames?.[0] ?? roomId,
        location: intent.entities?.location,
        capacity: intent.entities?.capacity,
        equipment: intent.entities?.equipment,
        status: 'active',
        canMergeWith: intent.constraints?.canMergeWith as RoomId[] | undefined,
      }, intent.actorRole);
    }
    case 'listRooms':
      return buildResult('success', '已查询会议室列表。', { rooms: state.rooms, mergedRooms: state.mergedRooms });
    case 'unknown':
      return buildResult('failed', '无法识别的意图。');
    default:
      return buildResult('failed', `暂不支持的意图：${intent.action}`);
  }
}

export function createBusinessResult(state: DemoState, result: BusinessResult): BusinessResult {
  appendBusinessResult(state, result);
  return result;
}

export {
  cancelBooking,
  createBooking,
  createRoom,
  createRule,
  deleteRoom,
  deleteRule,
  disableRoom,
  dynamicDisable,
  dynamicEnable,
  enableRoom,
  listAvailableRooms,
  mergeRooms,
  queryAvailability,
  unmergeRooms,
  updateRoom,
  updateRule,
};
