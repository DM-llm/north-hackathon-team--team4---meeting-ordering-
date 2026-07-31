import { saveDemoState } from '../state/demoState';
import type {
  Booking,
  BusinessResult,
  DemoState,
  RoomId,
  StructuredIntent,
  StructuredIntentAction,
  TimeRange,
} from '../types';
import { executeBusinessIntent } from './meetingBusiness';
import { queryStructuredIntent, type AgentQueryRequest, type AgentQueryResult, type NexAUClientOptions } from './agentClient';

export interface StructuredIntentExecutionResult extends AgentQueryResult {
  result: BusinessResult;
}

export interface NaturalLanguageExecutionRequest extends AgentQueryRequest {}

const DEFAULT_MERGED_ROOM_ID: RoomId = 'meeting-room-1-2';
const DEFAULT_MERGE_SOURCE_ROOM_IDS: RoomId[] = ['meeting-room-1', 'meeting-room-2'];

function isRoomId(value: unknown): value is RoomId {
  return typeof value === 'string' && value.length > 0;
}

function isRoomIdArray(value: unknown): value is RoomId[] {
  return Array.isArray(value) && value.every(isRoomId);
}

function isTimeRange(value: unknown): value is TimeRange {
  return !!value && typeof value === 'object' && typeof (value as TimeRange).start === 'string' && typeof (value as TimeRange).end === 'string';
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function getLatestConfirmedBooking(state: DemoState): Booking | undefined {
  return [...state.bookings]
    .filter((booking) => booking.status === 'confirmed')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function getActiveRoomIds(state: DemoState): RoomId[] {
  return state.rooms.filter((room) => room.status === 'active').map((room) => room.id);
}

function cloneIntent(intent: StructuredIntent): StructuredIntent {
  return {
    ...intent,
    entities: {
      ...(intent.entities ?? {}),
    },
    constraints: {
      ...(intent.constraints ?? {}),
    },
  };
}

function normalizeIntentForExecution(state: DemoState, intent: StructuredIntent): StructuredIntent {
  const normalized = cloneIntent(intent);
  const entities = normalized.entities ?? {};
  const constraints = normalized.constraints ?? {};

  if (normalized.action === 'cancelBooking' && !entities.bookingId && constraints.referent === 'latest') {
    const latestBooking = getLatestConfirmedBooking(state);
    if (latestBooking) {
      normalized.entities = { ...entities, bookingId: latestBooking.id };
    }
  }

  if (normalized.action === 'mergeRooms') {
    const sourceRoomIds = isRoomIdArray(entities.roomIds) && entities.roomIds.length >= 2
      ? entities.roomIds
      : isRoomIdArray(constraints.sourceRoomIds)
        ? constraints.sourceRoomIds
        : DEFAULT_MERGE_SOURCE_ROOM_IDS.filter((roomId) => state.rooms.some((room) => room.id === roomId));

    normalized.entities = {
      ...entities,
      roomIds: sourceRoomIds,
    };
    normalized.constraints = {
      ...constraints,
      sourceRoomIds,
      mergedRoomId: constraints.mergedRoomId === 'meeting-room-1-2' ? DEFAULT_MERGED_ROOM_ID : DEFAULT_MERGED_ROOM_ID,
    };
  }

  if (normalized.action === 'unmergeRooms') {
    normalized.entities = {
      ...entities,
      roomIds: isRoomIdArray(entities.roomIds) && entities.roomIds.length > 0 ? entities.roomIds : [DEFAULT_MERGED_ROOM_ID],
    };
  }

  if (normalized.action === 'dynamicDisableRoom') {
    normalized.entities = {
      ...entities,
      date: entities.date ?? todayISO(),
      range: isTimeRange(entities.range) ? entities.range : { start: '00:00', end: '24:00' },
    };
  }

  if (normalized.action === 'configureRule' && (!isRoomIdArray(entities.roomIds) || entities.roomIds.length === 0)) {
    const activeRoomIds = getActiveRoomIds(state);
    normalized.entities = {
      ...entities,
      roomIds: activeRoomIds,
    };
  }

  if (normalized.action === 'queryAvailability') {
    normalized.constraints = {
      ...constraints,
      includeMergedRooms: constraints.includeMergedRooms ?? true,
    };
  }

  if (normalized.action === 'createBooking' && isRoomIdArray(entities.roomIds) && entities.roomIds.length > 1) {
    normalized.constraints = {
      ...constraints,
      includeMergedRooms: constraints.includeMergedRooms ?? true,
    };
  }

  return normalized;
}

export function executeStructuredIntent(state: DemoState, intent: StructuredIntent): BusinessResult {
  const normalizedIntent = normalizeIntentForExecution(state, intent);
  state.intents = [normalizedIntent, ...(state.intents ?? [])];
  const result = executeBusinessIntent(state, normalizedIntent);
  saveDemoState(state);
  return result;
}

export async function executeNaturalLanguageRequest(
  request: NaturalLanguageExecutionRequest,
  state: DemoState,
  options: NexAUClientOptions = { endpoint: '/api/agent' },
): Promise<StructuredIntentExecutionResult> {
  const parsed = await queryStructuredIntent(request, options);
  const result = executeStructuredIntent(state, parsed.intent);
  return {
    ...parsed,
    result,
  };
}

function summarizeStructuredIntentAction(action: StructuredIntentAction): string {
  const labels: Record<StructuredIntentAction, string> = {
    listRooms: '查看会议室',
    queryAvailability: '查询可用会议室',
    createBooking: '创建预约',
    cancelBooking: '取消预约',
    configureRoom: '配置会议室',
    configureRule: '配置不可预约规则',
    updateRule: '更新规则',
    deleteRule: '删除规则',
    dynamicDisableRoom: '动态禁用会议室',
    dynamicEnableRoom: '动态启用会议室',
    mergeRooms: '合并会议室',
    unmergeRooms: '拆分合并会议室',
    adjustBooking: '调整预约',
    unknown: '未知意图',
  };

  return labels[action];
}

export function summarizeIntentExecution(intent: StructuredIntent, mode: AgentQueryResult['mode'], result: BusinessResult): string {
  const runtimeLabel = mode === 'nexau' ? 'NexAU Agent' : '本地 fallback';
  return `${runtimeLabel}：${summarizeStructuredIntentAction(intent.action)}；业务结果：${result.message}`;
}
