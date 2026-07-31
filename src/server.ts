/// <reference types="node" />
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createMeetingDatabase } from './db/meetingDatabase';
import { normalizeAgentIntentPayload, queryStructuredIntent } from './services/agentClient';
import {
  cancelBooking,
  createBooking,
  createRule,
  deleteRule,
  dynamicDisable,
  dynamicEnable,
  executeBusinessIntent,
  listAvailableRooms,
  mergeRooms,
  unmergeRooms,
  updateRule,
} from './services/meetingBusiness';
import type {
  Booking,
  BusinessResult,
  DemoState,
  StructuredIntent,
  TimeRange,
  UnavailabilityRule,
} from './types';

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const PORT = Number(process.env.API_PORT ?? 8787);
const HOST = process.env.API_HOST ?? '127.0.0.1';
const database = createMeetingDatabase();

function sendJson<T>(response: ServerResponse, status: number, payload: T | ApiEnvelope<T>): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': process.env.API_CORS_ORIGIN ?? '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendResult(response: ServerResponse, result: BusinessResult): void {
  sendJson(response, result.status === 'success' ? 200 : result.status === 'conflict' ? 409 : result.status === 'notFound' ? 404 : 400, result);
}

function readRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch (error) {
        reject(new Error(`请求体不是有效 JSON：${error instanceof Error ? error.message : 'unknown error'}`));
      }
    });
    request.on('error', reject);
  });
}

function getSearchParams(request: IncomingMessage): URLSearchParams {
  const url = new URL(request.url ?? '/', `http://${HOST}`);
  return url.searchParams;
}

function getParam(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name);
  return value && value.trim() ? value : undefined;
}

function getStringArrayParam(params: URLSearchParams, name: string): string[] | undefined {
  const value = getParam(params, name);
  if (!value) {
    return undefined;
  }

  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function getNumberParam(params: URLSearchParams, name: string): number | undefined {
  const value = getParam(params, name);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getBooleanParam(params: URLSearchParams, name: string): boolean | undefined {
  const value = getParam(params, name);
  if (value === undefined) {
    return undefined;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function getTimeRange(params: URLSearchParams): TimeRange | undefined {
  const start = getParam(params, 'start') ?? getParam(params, 'startTime');
  const end = getParam(params, 'end') ?? getParam(params, 'endTime');
  if (!start || !end) {
    return undefined;
  }

  return { start, end };
}

function persistState(state: DemoState): void {
  database.saveDemoState(state);
}

function actorRoleFromBody(body: Record<string, unknown>, fallback: 'admin' | 'member' | 'unknown'): 'admin' | 'member' | 'unknown' {
  return body.actorRole === 'admin' || body.actorRole === 'member' ? body.actorRole : fallback;
}

function handleHealth(_request: IncomingMessage, response: ServerResponse): void {
  sendJson(response, 200, {
    ok: true,
    data: {
      api: 'ok',
      sqlite: 'ok',
      databasePath: database.databasePath,
      counts: database.getTableCounts(),
    },
  });
}

function handleState(_request: IncomingMessage, response: ServerResponse): void {
  sendJson(response, 200, database.loadDemoState());
}

function handleRooms(_request: IncomingMessage, response: ServerResponse): void {
  const state = database.loadDemoState();
  sendJson(response, 200, {
    ok: true,
    data: {
      rooms: state.rooms,
      mergedRooms: state.mergedRooms,
    },
  });
}

function handleAvailability(request: IncomingMessage, response: ServerResponse): void {
  const params = getSearchParams(request);
  const state = database.loadDemoState();
  const result = listAvailableRooms(state, {
    date: getParam(params, 'date') ?? new Date().toISOString().slice(0, 10),
    range: getTimeRange(params),
    roomIds: getStringArrayParam(params, 'roomIds'),
    roomNames: getStringArrayParam(params, 'roomNames'),
    capacity: getNumberParam(params, 'capacity'),
    includeMergedRooms: getBooleanParam(params, 'includeMergedRooms'),
  });
  persistState(state);
  sendResult(response, result);
}

function filterBookings(state: DemoState, params: URLSearchParams): Booking[] {
  const date = getParam(params, 'date');
  const roomId = getParam(params, 'roomId');

  return state.bookings.filter((booking) => {
    if (date && booking.date !== date) {
      return false;
    }

    if (roomId && booking.roomId !== roomId && !booking.sourceRoomIds?.includes(roomId)) {
      return false;
    }

    return true;
  });
}

async function handleBookings(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === 'GET') {
    const state = database.loadDemoState();
    sendJson(response, 200, {
      ok: true,
      data: {
        bookings: filterBookings(state, getSearchParams(request)),
      },
    });
    return;
  }

  if (request.method === 'POST') {
    const body = await readRequestBody(request);
    const state = database.loadDemoState();
    const result = createBooking(state, {
      roomId: String(body.roomId ?? ''),
      sourceRoomIds: Array.isArray(body.sourceRoomIds) ? body.sourceRoomIds.map(String) : undefined,
      title: String(body.title ?? '未命名预约'),
      date: String(body.date ?? new Date().toISOString().slice(0, 10)),
      range: body.range as TimeRange,
      organizer: typeof body.organizer === 'object' && body.organizer ? { name: String((body.organizer as { name?: unknown }).name ?? 'member') } : { name: 'member' },
      attendees: Array.isArray(body.attendees) ? body.attendees as Booking['attendees'] : undefined,
      description: body.description ? String(body.description) : undefined,
    }, actorRoleFromBody(body, 'member'));
    persistState(state);
    sendResult(response, result);
    return;
  }

  if (request.method === 'DELETE') {
    const body = await readRequestBody(request);
    const state = database.loadDemoState();
    const bookingId = String(body.bookingId ?? '');
    const result = cancelBooking(state, bookingId, actorRoleFromBody(body, 'member'));
    persistState(state);
    sendResult(response, result);
    return;
  }

  sendJson(response, 405, { ok: false, error: 'Method not allowed' });
}

async function handleBookingById(request: IncomingMessage, response: ServerResponse, bookingId: string): Promise<void> {
  if (request.method !== 'DELETE') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  const state = database.loadDemoState();
  const result = cancelBooking(state, bookingId, 'member');
  persistState(state);
  sendResult(response, result);
}

function handleRules(request: IncomingMessage, response: ServerResponse): void {
  if (request.method === 'GET') {
    const state = database.loadDemoState();
    sendJson(response, 200, {
      ok: true,
      data: {
        rules: state.unavailabilityRules,
        dynamicDisables: state.dynamicDisables,
      },
    });
    return;
  }

  if (request.method === 'POST') {
    readRequestBody(request)
      .then((body) => {
        const state = database.loadDemoState();
        const result = createRule(state, {
          type: String(body.type ?? 'adminRule') as UnavailabilityRule['type'],
          scope: String(body.scope ?? 'room') as UnavailabilityRule['scope'],
          roomIds: Array.isArray(body.roomIds) ? body.roomIds.map(String) : [],
          title: String(body.title ?? '管理员规则'),
          description: body.description ? String(body.description) : undefined,
          startDate: body.startDate ? String(body.startDate) : undefined,
          endDate: body.endDate ? String(body.endDate) : undefined,
          weekdays: Array.isArray(body.weekdays) ? body.weekdays as UnavailabilityRule['weekdays'] : undefined,
          ranges: Array.isArray(body.ranges) ? body.ranges as TimeRange[] : [{ start: '00:00', end: '24:00' }],
          active: body.active === undefined ? true : Boolean(body.active),
        }, actorRoleFromBody(body, 'admin'));
        persistState(state);
        sendResult(response, result);
      })
      .catch((error) => {
        sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    return;
  }

  sendJson(response, 405, { ok: false, error: 'Method not allowed' });
}

async function handleRuleById(request: IncomingMessage, response: ServerResponse, ruleId: string): Promise<void> {
  if (request.method === 'GET') {
    const state = database.loadDemoState();
    const rule = state.unavailabilityRules.find((existingRule) => existingRule.id === ruleId);
    if (!rule) {
      sendJson(response, 404, { ok: false, error: `未找到规则：${ruleId}` });
      return;
    }

    sendJson(response, 200, { ok: true, data: { rule } });
    return;
  }

  if (request.method === 'PATCH') {
    const body = await readRequestBody(request);
    const state = database.loadDemoState();
    const result = updateRule(state, ruleId, body as Partial<UnavailabilityRule>, actorRoleFromBody(body, 'admin'));
    persistState(state);
    sendResult(response, result);
    return;
  }

  if (request.method === 'DELETE') {
    const state = database.loadDemoState();
    const result = deleteRule(state, ruleId, 'admin');
    persistState(state);
    sendResult(response, result);
    return;
  }

  sendJson(response, 405, { ok: false, error: 'Method not allowed' });
}

async function handleIntentExecution(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  const body = await readRequestBody(request);
  const intentPayload = body.intent as StructuredIntent | undefined;
  if (!intentPayload?.action) {
    sendJson(response, 400, { ok: false, error: '请求体必须包含 intent.action。' });
    return;
  }

  const intent = normalizeAgentIntentPayload(intentPayload);
  const state = database.loadDemoState();
  state.intents.push(intent);
  const result = executeBusinessIntent(state, intent);
  persistState(state);
  sendResult(response, result);
}

async function handleAgentQuery(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readRequestBody(request);
    const result = await queryStructuredIntent({
      input: String(body.input ?? ''),
      actorRole: actorRoleFromBody(body, 'unknown'),
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error: error instanceof Error ? error.message : 'NexAU 调用失败。',
    });
  }
}

async function handleSeed(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  const body = await readRequestBody(request);
  const reset = body.reset === true;
  const state = database.seedDemoData(reset);
  sendJson(response, 200, {
    ok: true,
    data: {
      reset,
      counts: database.getTableCounts(),
      rooms: state.rooms,
      mergedRooms: state.mergedRooms,
      rules: state.unavailabilityRules,
    },
  });
}

async function handleDynamicDisable(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  const body = await readRequestBody(request);
  const state = database.loadDemoState();
  const result = dynamicDisable(state, {
    roomId: String(body.roomId ?? ''),
    reason: String(body.reason ?? '管理员动态禁用'),
    startDate: String(body.startDate ?? body.date ?? new Date().toISOString().slice(0, 10)),
    endDate: body.endDate ? String(body.endDate) : undefined,
    ranges: Array.isArray(body.ranges) ? body.ranges as TimeRange[] : [{ start: '00:00', end: '24:00' }],
    active: body.active === undefined ? true : Boolean(body.active),
  }, actorRoleFromBody(body, 'admin'));
  persistState(state);
  sendResult(response, result);
}

async function handleDynamicEnable(request: IncomingMessage, response: ServerResponse, roomId: string): Promise<void> {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  const body = await readRequestBody(request);
  const state = database.loadDemoState();
  const result = dynamicEnable(state, roomId, body.reason ? String(body.reason) : undefined, actorRoleFromBody(body, 'admin'));
  persistState(state);
  sendResult(response, result);
}

async function handleMergeRooms(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  const body = await readRequestBody(request);
  const state = database.loadDemoState();
  const result = mergeRooms(state, {
    sourceRoomIds: Array.isArray(body.sourceRoomIds) ? body.sourceRoomIds.map(String) : [],
    mergedRoomId: body.mergedRoomId ? String(body.mergedRoomId) : undefined,
    name: body.name ? String(body.name) : undefined,
    location: body.location ? String(body.location) : undefined,
    capacity: typeof body.capacity === 'number' ? body.capacity : undefined,
    equipment: Array.isArray(body.equipment) ? body.equipment.map(String) : undefined,
    date: body.date ? String(body.date) : undefined,
  }, body.range as TimeRange | undefined, actorRoleFromBody(body, 'admin'));
  persistState(state);
  sendResult(response, result);
}

async function handleUnmergeRooms(request: IncomingMessage, response: ServerResponse, mergedRoomId: string): Promise<void> {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  const body = await readRequestBody(request);
  const state = database.loadDemoState();
  const result = unmergeRooms(state, mergedRoomId, actorRoleFromBody(body, 'admin'));
  persistState(state);
  sendResult(response, result);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${HOST}`);

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    handleHealth(request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/state') {
    handleState(request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/rooms') {
    handleRooms(request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/availability') {
    handleAvailability(request, response);
    return;
  }

  if (url.pathname === '/api/bookings') {
    await handleBookings(request, response);
    return;
  }

  if (url.pathname.startsWith('/api/bookings/')) {
    await handleBookingById(request, response, decodeURIComponent(url.pathname.slice('/api/bookings/'.length)));
    return;
  }

  if (url.pathname === '/api/rules') {
    handleRules(request, response);
    return;
  }

  if (url.pathname.startsWith('/api/rules/')) {
    await handleRuleById(request, response, decodeURIComponent(url.pathname.slice('/api/rules/'.length)));
    return;
  }

  if (url.pathname === '/api/intents/execute') {
    await handleIntentExecution(request, response);
    return;
  }

  if (url.pathname === '/api/agent/query') {
    await handleAgentQuery(request, response);
    return;
  }

  if (url.pathname === '/api/seed') {
    await handleSeed(request, response);
    return;
  }

  if (url.pathname === '/api/dynamic-disable') {
    await handleDynamicDisable(request, response);
    return;
  }

  if (url.pathname.startsWith('/api/dynamic-enable/')) {
    await handleDynamicEnable(request, response, decodeURIComponent(url.pathname.slice('/api/dynamic-enable/'.length)));
    return;
  }

  if (url.pathname === '/api/merge-rooms') {
    await handleMergeRooms(request, response);
    return;
  }

  if (url.pathname.startsWith('/api/unmerge-rooms/')) {
    await handleUnmergeRooms(request, response, decodeURIComponent(url.pathname.slice('/api/unmerge-rooms/'.length)));
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: `Not found: ${request.method} ${url.pathname}`,
  });
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Meeting ordering API server listening on http://${HOST}:${PORT}`);
});

function shutdown(): void {
  database.close();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
