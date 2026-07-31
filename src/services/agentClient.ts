import { z } from 'zod';
import type {
  BookingAttendee,
  StructuredIntent,
  StructuredIntentAction,
  TimeRange,
} from '../types';

export type AgentRuntimeMode = 'nexau' | 'local';

export interface AgentQueryRequest {
  input: string;
  actorRole?: 'admin' | 'member' | 'unknown';
}

export interface AgentQueryResult {
  intent: StructuredIntent;
  mode: AgentRuntimeMode;
  rawResponse?: string;
  error?: string;
  events?: AgentStreamEvent[];
}

export interface AgentStreamEvent {
  id?: string;
  type: string;
  data: string;
  retry?: string;
  raw: string;
}

export interface NexAUStreamResponse {
  events: AgentStreamEvent[];
  rawText: string;
}

export interface NexAUClientOptions {
  baseUrl?: string;
  /**
   * Full endpoint path when using a Vite/Node proxy, for example `/api/agent`.
   * If omitted, the client appends `/query` or `/stream` to `baseUrl`.
   */
  endpoint?: string;
  streamEndpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface NexAUQueryOptions extends AgentQueryRequest {
  prompt?: string;
  endpoint?: string;
  stream?: boolean;
  signal?: AbortSignal;
  userId?: string;
}

const ACTION_VALUES = [
  'listRooms',
  'queryAvailability',
  'createBooking',
  'cancelBooking',
  'configureRoom',
  'configureRule',
  'updateRule',
  'deleteRule',
  'dynamicDisableRoom',
  'dynamicEnableRoom',
  'mergeRooms',
  'unmergeRooms',
  'adjustBooking',
  'unknown',
] as const;

const actorRoleSchema = z.enum(['admin', 'member', 'unknown']);
const timeRangeSchema = z.object({
  start: z.string().min(1).max(8),
  end: z.string().min(1).max(8),
});

const attendeeSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
});

const agentIntentPayloadSchema = z.object({
  action: z.enum(ACTION_VALUES),
  actorRole: actorRoleSchema,
  entities: z
    .object({
      roomIds: z.array(z.string().min(1)).optional(),
      roomNames: z.array(z.string().min(1)).optional(),
      date: z.string().min(1).optional(),
      range: timeRangeSchema.optional(),
      title: z.string().optional(),
      organizer: attendeeSchema.optional(),
      attendees: z.array(attendeeSchema).optional(),
      bookingId: z.string().optional(),
      ruleId: z.string().optional(),
      reason: z.string().optional(),
      capacity: z.number().optional(),
      location: z.string().optional(),
      equipment: z.array(z.string()).optional(),
    })
    .optional()
    .default({}),
  constraints: z.record(z.string(), z.unknown()).optional().default({}),
});

export type ParsedStructuredIntent = Omit<StructuredIntent, 'id' | 'rawText' | 'createdAt'>;

export const structuredIntentSchema = agentIntentPayloadSchema;

const TIME_RANGE_PATTERN = /(?<start>\d{1,2}\s*点?(?:\s*\d{1,2}\s*分?)?)\s*(?:到|至|-|—|~|～)\s*(?<end>\d{1,2}\s*点?(?:\s*\d{1,2}\s*分?)?)/;
const DATE_PATTERN = /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/;

type WeekdayName = '一' | '二' | '三' | '四' | '五' | '六' | '日' | '天';

const WEEKDAY_OFFSETS: Record<WeekdayName, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
};

function nowDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): string {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function addWeekdays(date: Date, weekday: number): string {
  const current = date.getDay();
  const delta = (weekday - current + 7) % 7;
  return addDays(date, delta);
}

function addRelativeWeekday(baseDate: Date, prefix: '本周' | '这周' | '下周' | '这周' | '下', weekdayName: WeekdayName): string {
  const weekday = WEEKDAY_OFFSETS[weekdayName];
  const base = new Date(baseDate);
  if (prefix === '下周' || prefix === '下') {
    base.setDate(base.getDate() + 7);
  }
  return addWeekdays(base, weekday);
}

function normalizeDateText(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }

  const explicitDate = DATE_PATTERN.exec(text);
  if (explicitDate) {
    return explicitDate[1].replace(/\//g, '-');
  }

  const today = new Date();
  if (text.includes('今天')) {
    return nowDate();
  }
  if (text.includes('明天')) {
    return addDays(today, 1);
  }
  if (text.includes('后天')) {
    return addDays(today, 2);
  }
  if (text.includes('昨天')) {
    return addDays(today, -1);
  }

  const relativeWeekdayMatch = /(本周|这周|下周|下)([一二三四五六日天])/.exec(text);
  if (relativeWeekdayMatch) {
    return addRelativeWeekday(today, relativeWeekdayMatch[1] as '本周' | '这周' | '下周' | '下', relativeWeekdayMatch[2] as WeekdayName);
  }

  return undefined;
}

function normalizeTimeValue(value: string, contextText: string): string | undefined {
  const cleaned = value.trim().replace(/\s+/g, '');
  const match = cleaned.match(/^(\d{1,2})(?::?(\d{1,2}))?/);
  if (!match) {
    return undefined;
  }

  let hour = Number.parseInt(match[1], 10);
  const minute = match[2] ? Number.parseInt(match[2], 10) : 0;
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return undefined;
  }

  if (contextText.includes('下午') && hour < 12) {
    hour += 12;
  }
  if (contextText.includes('晚上') && hour < 12) {
    hour += 12;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeRangeFromText(text: string): TimeRange | undefined {
  const match = TIME_RANGE_PATTERN.exec(text);
  if (!match?.groups) {
    return undefined;
  }

  const start = normalizeTimeValue(match.groups.start, text);
  const end = normalizeTimeValue(match.groups.end, text);
  if (!start || !end) {
    return undefined;
  }

  return { start, end };
}

function inferDefaultRangeFromText(text: string): TimeRange | undefined {
  if (/中午|午餐/.test(text)) {
    return { start: '12:00', end: '13:30' };
  }
  if (/全天|一整天/.test(text)) {
    return { start: '00:00', end: '24:00' };
  }

  return undefined;
}

function extractAttendees(text: string): BookingAttendee[] {
  const names: string[] = [];
  const nameBeforeKeyword = /([\u4e00-\u9fa5A-Za-z0-9_-]{2,20})\s*(?:参加|参会|出席)/u.exec(text);
  if (nameBeforeKeyword?.[1]) {
    names.push(nameBeforeKeyword[1]);
  }

  const withoutPunctuation = text.replace(/[，,。；;]/g, ' ');
  const parts = withoutPunctuation.split(/\s+/).filter(Boolean);
  const keywords = ['参加', '参会', '出席'];

  parts.forEach((part) => {
    const index = keywords.findIndex((keyword) => part.includes(keyword));
    if (index >= 0) {
      const name = part.slice(0, index).trim();
      if (name && !names.includes(name)) {
        names.push(name);
      }
    }
  });

  return names.map((name) => ({ name }));
}

function inferAction(text: string): StructuredIntentAction {
  if (/取消|撤销|退订/.test(text)) {
    return 'cancelBooking';
  }
  if (/查|查询|查看|可用|空闲|可约/.test(text) && !/预约|预订|订/.test(text)) {
    return 'queryAvailability';
  }
  if (/合并/.test(text)) {
    return 'mergeRooms';
  }
  if (/拆分|取消合并|恢复分开|分开/.test(text)) {
    return 'unmergeRooms';
  }
  if (/临时禁用|禁用|维修|故障|停用/.test(text)) {
    return 'dynamicDisableRoom';
  }
  if (/启用|恢复可用|解除禁用/.test(text)) {
    return 'dynamicEnableRoom';
  }
  if (/预约|预订|订一个|开个会/.test(text)) {
    return 'createBooking';
  }
  if (/新增|添加|创建会议室|配置会议室|设置会议室/.test(text)) {
    return 'configureRoom';
  }
  if (/新增规则|添加规则|配置规则|设置规则|不可预约|不能预约|不可用|停用/.test(text) && !/动态|临时|维修/.test(text)) {
    return 'configureRule';
  }
  if (/更新规则|修改规则|改规则|刚才说错|说错/.test(text)) {
    return 'updateRule';
  }
  if (/删除规则|移除规则|取消规则/.test(text)) {
    return 'deleteRule';
  }
  if (/调整|改到|换到|改时间|改会议室/.test(text)) {
    return 'adjustBooking';
  }
  if (/会议室列表|房间列表|有哪些会议室|列出会议室/.test(text)) {
    return 'listRooms';
  }

  return 'unknown';
}

function inferActorRole(text: string, requestedRole?: 'admin' | 'member' | 'unknown'): 'admin' | 'member' | 'unknown' {
  if (requestedRole && requestedRole !== 'unknown') {
    return requestedRole;
  }

  if (/管理员|配置|规则|禁用|启用|合并|拆分|调整/.test(text)) {
    return 'admin';
  }
  if (/预约|取消|查询|帮我/.test(text)) {
    return 'member';
  }

  return 'unknown';
}

function inferRoomIds(text: string): string[] {
  const mapping: Array<[RegExp, string]> = [
    [/活动室/g, 'activity-room'],
    [/会议室一/g, 'meeting-room-1'],
    [/会议室二/g, 'meeting-room-2'],
    [/503/g, 'room-503'],
    [/504/g, 'room-504'],
    [/505/g, 'room-505'],
    [/506/g, 'room-506'],
  ];

  const ids = new Set<string>();
  mapping.forEach(([pattern, roomId]) => {
    if (pattern.test(text)) {
      ids.add(roomId);
    }
  });
  if (/小会议室|小型会议室/.test(text)) {
    ['room-503', 'room-505', 'room-506'].forEach((roomId) => ids.add(roomId));
  }

  return [...ids];
}

function inferRoomNames(text: string): string[] {
  const names = new Set<string>();
  if (/活动室/.test(text)) {
    names.add('活动室');
  }
  if (/会议室一/.test(text)) {
    names.add('会议室一');
  }
  if (/会议室二/.test(text)) {
    names.add('会议室二');
  }
  if (/503/.test(text) || /小会议室|小型会议室/.test(text)) {
    names.add('503');
  }
  if (/504/.test(text) || /小会议室|小型会议室/.test(text)) {
    names.add('504');
  }
  if (/505/.test(text) || /小会议室|小型会议室/.test(text)) {
    names.add('505');
  }
  if (/506/.test(text) || /小会议室|小型会议室/.test(text)) {
    names.add('506');
  }

  return [...names];
}

function inferTitle(text: string): string | undefined {
  if (/开会/.test(text)) {
    return '会议';
  }

  const match = /(?:预约|预订)(?:[^，。；;]*?)(?:([\u4e00-\u9fa5A-Za-z0-9\-]{2,40}))/u.exec(text);
  if (match?.[1]) {
    const title = match[1].replace(/^(帮我|一下|的|参加|张三)/, '').trim();
    if (title && title.length <= 40) {
      return title;
    }
  }

  return undefined;
}

function inferReason(text: string): string | undefined {
  const reasonMatch = /(?:维修|故障|清洁|改造|停电|保养)(?:，|,|。|；|;|$)/.exec(text);
  if (reasonMatch?.[0]) {
    return reasonMatch[0].replace(/[，,。；;\s]/g, '');
  }

  if (/禁用/.test(text)) {
    return '临时禁用';
  }

  return undefined;
}

function inferConstraints(text: string, action: StructuredIntentAction, roomIds: string[]): Record<string, unknown> {
  const constraints: Record<string, unknown> = {};

  if (action === 'configureRule') {
    constraints.ruleType = /每周/.test(text) ? 'weeklyUnavailable' : /午餐|中午/.test(text) ? 'lunch' : 'temporaryMaintenance';
    constraints.ruleScope = 'room';
    constraints.active = true;
  }

  if (action === 'dynamicDisableRoom') {
    constraints.ruleType = 'temporaryMaintenance';
  }

  if (action === 'mergeRooms') {
    constraints.sourceRoomIds = roomIds.length > 0 ? roomIds : ['meeting-room-1', 'meeting-room-2'];
    constraints.mergedRoomId = 'meeting-room-1-2';
  }

  if (action === 'unmergeRooms') {
    constraints.mergedRoomId = 'meeting-room-1-2';
  }

  if (action === 'cancelBooking' && /刚刚|刚才|最新|上一条/.test(text)) {
    constraints.referent = 'latest';
  }

  if (/小会议室|小型会议室/.test(text)) {
    constraints.roomSize = 'small';
  }

  return constraints;
}

export function parseStructuredIntent(text: string, actorRole?: 'admin' | 'member' | 'unknown'): StructuredIntent {
  const action = inferAction(text);
  const date = normalizeDateText(text);
  const range = normalizeRangeFromText(text) ?? inferDefaultRangeFromText(text);
  const roomIds = inferRoomIds(text);
  const roomNames = inferRoomNames(text);
  const attendees = extractAttendees(text);
  const role = inferActorRole(text, actorRole);
  const constraints = inferConstraints(text, action, roomIds);
  const title = inferTitle(text);

  const intent: StructuredIntent = {
    id: `intent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    actorRole: role,
    rawText: text,
    entities: {
      ...(roomIds.length > 0 ? { roomIds } : {}),
      ...(roomNames.length > 0 ? { roomNames } : {}),
      ...(date ? { date } : {}),
      ...(range ? { range } : {}),
      ...(attendees.length > 0 ? { attendees } : {}),
      ...(title ? { title } : {}),
      ...(inferReason(text) ? { reason: inferReason(text) } : {}),
    },
    constraints,
    createdAt: new Date().toISOString(),
  };

  const parsed = structuredIntentSchema.parse(intent);
  return {
    ...parsed,
    id: intent.id,
    rawText: text,
    createdAt: intent.createdAt,
  };
}

function getNexAUBaseUrl(): string | undefined {
  const globalEnv = (globalThis as {
    VITE_NEXAU_HTTP_URL?: string;
    NEXAU_HTTP_URL?: string;
    process?: { env?: Record<string, string | undefined> };
  });

  return globalEnv.VITE_NEXAU_HTTP_URL ?? globalEnv.process?.env?.VITE_NEXAU_HTTP_URL ?? globalEnv.NEXAU_HTTP_URL ?? globalEnv.process?.env?.NEXAU_HTTP_URL;
}

function getNexAUQueryEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/query`;
}

function getNexAUStreamEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/stream`;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    throw new Error('NexAU 返回空响应。');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`NexAU 响应不是有效 JSON：${text.slice(0, 200)}`);
  }
}

function extractIntentPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const objectPayload = payload as Record<string, unknown>;
  if (objectPayload.intent && typeof objectPayload.intent === 'object') {
    return objectPayload.intent;
  }
  if (objectPayload.response !== undefined) {
    if (typeof objectPayload.response === 'string') {
      return parseAgentJson(objectPayload.response);
    }
    return objectPayload.response;
  }
  if (objectPayload.data && typeof objectPayload.data === 'object') {
    return objectPayload.data;
  }
  if (objectPayload.message && typeof objectPayload.message === 'string') {
    try {
      return JSON.parse(objectPayload.message) as unknown;
    } catch {
      return objectPayload.message;
    }
  }

  return objectPayload;
}

function withTimeout(signal?: AbortSignal, timeoutMs = 15000): { signal: AbortSignal; abort: () => void } {
  if (signal) {
    return { signal, abort: () => undefined };
  }

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    abort: () => globalThis.clearTimeout(timer),
  };
}

export function parseSseEvents(rawText: string): AgentStreamEvent[] {
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      let id: string | undefined;
      let eventType = 'message';
      let retry: string | undefined;
      const dataLines: string[] = [];

      block.split('\n').forEach((line) => {
        if (!line || line.startsWith(':')) {
          return;
        }

        const separatorIndex = line.indexOf(':');
        const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
        const value = separatorIndex >= 0 ? line.slice(separatorIndex + 1).replace(/^ /, '') : '';

        if (field === 'id') {
          id = value;
        } else if (field === 'event') {
          eventType = value || 'message';
        } else if (field === 'retry') {
          retry = value;
        } else if (field === 'data') {
          dataLines.push(value);
        }
      });

      return {
        id,
        type: eventType,
        data: dataLines.join('\n'),
        retry,
        raw: block,
      };
    });
}

function buildNexAUPayload(options: NexAUQueryOptions): Record<string, unknown> {
  const actorRole = options.actorRole ?? 'unknown';
  const promptSuffix = options.prompt ? `\n\n${options.prompt}` : '';

  return {
    messages: `用户输入：${options.input}\n当前用户角色：${actorRole}${promptSuffix}`,
    user_id: options.userId ?? 'meeting-ordering-demo',
    context: {
      actorRole,
      inputLanguage: 'zh-CN',
      expectedOutput: 'structured-json-intent-only',
    },
  };
}

export class NexAUAgentClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultEndpoint?: string;
  private readonly defaultStreamEndpoint?: string;

  constructor(options: NexAUClientOptions = {}) {
    const configuredBaseUrl = options.baseUrl ?? getNexAUBaseUrl();
    if (!configuredBaseUrl && !options.endpoint && !options.streamEndpoint) {
      throw new Error('未配置 NexAU HTTP endpoint。请设置 VITE_NEXAU_HTTP_URL、NEXAU_HTTP_URL，或传入 endpoint: "/api/agent"。');
    }

    this.baseUrl = configuredBaseUrl?.replace(/\/$/, '') ?? '';
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultEndpoint = options.endpoint;
    this.defaultStreamEndpoint = options.streamEndpoint ?? (options.endpoint?.replace(/agent$/, 'agent-stream') ?? undefined);
  }

  getQueryEndpoint(): string {
    return this.defaultEndpoint ?? getNexAUQueryEndpoint(this.baseUrl);
  }

  getStreamEndpoint(): string {
    return this.defaultStreamEndpoint ?? getNexAUStreamEndpoint(this.baseUrl);
  }

  async query(options: NexAUQueryOptions): Promise<unknown> {
    const endpoint = options.endpoint ?? this.getQueryEndpoint();
    const timeout = withTimeout(options.signal, this.timeoutMs);
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildNexAUPayload(options)),
      signal: timeout.signal,
    });
    timeout.abort();

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`NexAU /query 调用失败：${response.status} ${response.statusText} ${text.slice(0, 200)}`);
    }

    const payload = await parseJsonResponse(response);
    return extractIntentPayload(payload);
  }

  async stream(options: NexAUQueryOptions): Promise<ReadableStream<Uint8Array>> {
    const endpoint = options.endpoint ?? this.getStreamEndpoint();
    const timeout = withTimeout(options.signal, this.timeoutMs);
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...buildNexAUPayload(options),
        stream: true,
      }),
      signal: timeout.signal,
    });
    timeout.abort();

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`NexAU /stream 调用失败：${response.status} ${response.statusText} ${text.slice(0, 200)}`);
    }

    if (!response.body) {
      throw new Error('NexAU /stream 响应未返回 body。');
    }

    return response.body;
  }
}

export function createNexAUAgentClient(options: NexAUClientOptions = {}): NexAUAgentClient | undefined {
  try {
    return new NexAUAgentClient(options);
  } catch {
    return undefined;
  }
}

export async function queryStructuredIntent(
  request: AgentQueryRequest,
  options: NexAUClientOptions = {},
): Promise<AgentQueryResult> {
  const client = createNexAUAgentClient(options);
  if (!client) {
    const intent = parseStructuredIntent(request.input, request.actorRole);
    return {
      intent,
      mode: 'local',
      error: 'NexAU endpoint 未配置，已使用本地解析器。',
    };
  }

  try {
    const payload = await client.query({ input: request.input, actorRole: request.actorRole });
    const parsed = structuredIntentSchema.parse(payload);
    return {
      intent: {
        ...parsed,
        id: `intent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        rawText: request.input,
        createdAt: new Date().toISOString(),
      },
      mode: 'nexau',
      rawResponse: JSON.stringify(payload),
    };
  } catch (error) {
    const intent = parseStructuredIntent(request.input, request.actorRole);
    return {
      intent,
      mode: 'local',
      error: error instanceof Error ? error.message : 'NexAU 调用失败，已使用本地解析器。',
    };
  }
}

export function parseAgentJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Agent 输出为空。');
  }

  const jsonMatch = /\{[\s\S]*\}/.exec(trimmed);
  if (!jsonMatch) {
    throw new Error('Agent 输出中未找到 JSON 对象。');
  }

  return JSON.parse(jsonMatch[0]) as unknown;
}

export function normalizeAgentIntentPayload(payload: unknown, rawText = ''): StructuredIntent {
  const parsedPayload = structuredIntentSchema.parse(typeof payload === 'string' ? parseAgentJson(payload) : payload);
  return {
    ...parsedPayload,
    id: `intent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    rawText,
    createdAt: new Date().toISOString(),
  };
}
