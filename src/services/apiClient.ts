import type {
  Booking,
  BusinessResult,
  DemoState,
  DynamicDisablement,
  MergedRoom,
  Room,
  RoomId,
  StructuredIntent,
  TimeRange,
  UnavailabilityRule,
} from '../types';

export interface QueryAvailabilityRequest {
  date: string;
  range?: TimeRange;
  roomIds?: RoomId[];
  roomNames?: string[];
  capacity?: number;
  includeMergedRooms?: boolean;
}

export interface ApiHealth {
  status: 'ok';
  api: string;
  sqlite: 'ready' | 'empty';
  updatedAt?: string;
}

export interface RoomsPayload {
  rooms: Room[];
  mergedRooms: MergedRoom[];
}

export interface BookingsPayload {
  bookings: Booking[];
}

export interface RulesPayload {
  rules: UnavailabilityRule[];
  dynamicDisables: DynamicDisablement[];
}

export interface BookingCreateRequest {
  roomId: RoomId;
  sourceRoomIds?: RoomId[];
  title: string;
  date: string;
  range: TimeRange;
  organizer: { name: string };
  attendees?: { name: string; email?: string }[];
  description?: string;
}

export interface RuleCreateRequest {
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

export interface DynamicDisableRequest {
  roomId: RoomId;
  reason: string;
  startDate: string;
  endDate?: string;
  ranges: TimeRange[];
  active?: boolean;
}

function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL ?? '/api';
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`API 响应不是有效 JSON：${text.slice(0, 200)}`);
  }
}

async function parseErrorResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(joinUrl(getApiBaseUrl(), path), {
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = await parseErrorResponse(response);
    const message = typeof payload.error === 'string'
      ? payload.error
      : typeof payload.message === 'string'
        ? payload.message
        : `API 请求失败：${response.status}`;
    throw new Error(message);
  }

  return parseResponse<T>(response);
}

function queryParam(name: string, value: string | number | undefined): string | undefined {
  return value === undefined ? undefined : `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`;
}

function arrayQueryParam(name: string, values: string[] | undefined): string | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  return `${encodeURIComponent(name)}=${encodeURIComponent(values.join(','))}`;
}

function buildQuery(params: Array<string | undefined>): string {
  const filtered = params.filter((param): param is string => Boolean(param));
  return filtered.length > 0 ? `?${filtered.join('&')}` : '';
}

export async function fetchApiHealth(): Promise<ApiHealth> {
  return requestJson<ApiHealth>('/health');
}

export async function fetchState(): Promise<DemoState> {
  return requestJson<DemoState>('/state');
}

export async function fetchRooms(): Promise<RoomsPayload> {
  return requestJson<RoomsPayload>('/rooms');
}

export async function queryAvailability(input: QueryAvailabilityRequest): Promise<BusinessResult> {
  const query = buildQuery([
    queryParam('date', input.date),
    input.range ? queryParam('start', input.range.start) : undefined,
    input.range ? queryParam('end', input.range.end) : undefined,
    arrayQueryParam('roomIds', input.roomIds),
    arrayQueryParam('roomNames', input.roomNames),
    queryParam('capacity', input.capacity),
    input.includeMergedRooms === undefined ? undefined : queryParam('includeMergedRooms', input.includeMergedRooms ? '1' : '0'),
  ]);
  return requestJson<BusinessResult>(`/availability${query}`);
}

export async function fetchBookings(params?: { date?: string; roomId?: RoomId }): Promise<BookingsPayload> {
  const query = buildQuery([
    queryParam('date', params?.date),
    queryParam('roomId', params?.roomId),
  ]);
  return requestJson<BookingsPayload>(`/bookings${query}`);
}

export async function createBooking(input: BookingCreateRequest, actorRole = 'member'): Promise<BusinessResult> {
  return requestJson<BusinessResult>('/bookings', {
    method: 'POST',
    body: JSON.stringify({ ...input, actorRole }),
  });
}

export async function cancelBooking(input: { bookingId: string; reason?: string }, actorRole = 'member'): Promise<BusinessResult> {
  return requestJson<BusinessResult>('/bookings', {
    method: 'DELETE',
    body: JSON.stringify({ ...input, actorRole }),
  });
}

export async function fetchRules(): Promise<RulesPayload> {
  return requestJson<RulesPayload>('/rules');
}

export async function createRule(input: RuleCreateRequest, actorRole = 'admin'): Promise<BusinessResult> {
  return requestJson<BusinessResult>('/rules', {
    method: 'POST',
    body: JSON.stringify({ ...input, actorRole }),
  });
}

export async function updateRule(ruleId: string, patch: Partial<RuleCreateRequest>, actorRole = 'admin'): Promise<BusinessResult> {
  return requestJson<BusinessResult>(`/rules/${encodeURIComponent(ruleId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, actorRole }),
  });
}

export async function deleteRule(ruleId: string, actorRole = 'admin'): Promise<BusinessResult> {
  return requestJson<BusinessResult>(`/rules/${encodeURIComponent(ruleId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ actorRole }),
  });
}

export async function dynamicDisable(input: DynamicDisableRequest, actorRole = 'admin'): Promise<BusinessResult> {
  return requestJson<BusinessResult>('/dynamic-disable', {
    method: 'POST',
    body: JSON.stringify({ ...input, actorRole }),
  });
}

export async function dynamicEnable(roomId: RoomId, reason?: string, actorRole = 'admin'): Promise<BusinessResult> {
  return requestJson<BusinessResult>(`/dynamic-enable/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    body: JSON.stringify({ reason, actorRole }),
  });
}

export async function mergeRooms(input: {
  sourceRoomIds: RoomId[];
  mergedRoomId?: RoomId;
  name?: string;
  location?: string;
  capacity?: number;
  equipment?: string[];
  date?: string;
  range?: TimeRange;
}, actorRole = 'admin'): Promise<BusinessResult> {
  return requestJson<BusinessResult>('/merge-rooms', {
    method: 'POST',
    body: JSON.stringify({ ...input, actorRole }),
  });
}

export async function unmergeRooms(mergedRoomId: RoomId, actorRole = 'admin'): Promise<BusinessResult> {
  return requestJson<BusinessResult>(`/unmerge-rooms/${encodeURIComponent(mergedRoomId)}`, {
    method: 'POST',
    body: JSON.stringify({ actorRole }),
  });
}

export async function executeIntent(intent: StructuredIntent): Promise<BusinessResult> {
  return requestJson<BusinessResult>('/intents/execute', {
    method: 'POST',
    body: JSON.stringify({ intent }),
  });
}

export async function queryAgentIntent(input: string, actorRole?: 'admin' | 'member' | 'unknown'): Promise<{ intent: StructuredIntent; mode: 'nexau' | 'local'; error?: string; rawResponse?: string }> {
  return requestJson('/agent/query', {
    method: 'POST',
    body: JSON.stringify({ input, actorRole }),
  });
}

export async function seedDemo(reset = false): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return requestJson('/seed', {
    method: 'POST',
    body: JSON.stringify({ reset }),
  });
}
