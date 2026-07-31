import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminPanel from './components/AdminPanel';
import AvailabilitySearch from './components/AvailabilitySearch';
import BookingForm from './components/BookingForm';
import BookingList from './components/BookingList';
import ConflictMessage from './components/ConflictMessage';
import MeetingRoomsPanel from './components/MeetingRoomsPanel';
import NaturalLanguageInput from './components/NaturalLanguageInput';
import BusinessResultPanel from './components/BusinessResultPanel';
import {
  cancelBooking as apiCancelBooking,
  createBooking as apiCreateBooking,
  createRule as apiCreateRule,
  dynamicDisable as apiDynamicDisable,
  dynamicEnable as apiDynamicEnable,
  executeIntent as apiExecuteIntent,
  fetchApiHealth,
  fetchState,
  mergeRooms as apiMergeRooms,
  queryAgentIntent,
  queryAvailability as apiQueryAvailability,
  unmergeRooms as apiUnmergeRooms,
} from './services/apiClient';
import type {
  BusinessResult,
  DemoState,
  MergedRoom,
  Room,
  RoomId,
  RoomStatus,
  StructuredIntent,
  TimeRange,
} from './types';

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const SMALL_ROOM_IDS: RoomId[] = ['room-503', 'room-505', 'room-506'];

type ResourceKind = 'room' | 'mergedRoom';

interface ResourceOption {
  id: RoomId;
  name: string;
  kind: ResourceKind;
  capacity?: number;
  sourceRoomIds?: RoomId[];
  status: RoomStatus;
}

interface AvailabilityFormState {
  date: string;
  start: string;
  end: string;
}

interface BookingFormState {
  roomId: RoomId;
  title: string;
  organizer: string;
  date: string;
  start: string;
  end: string;
}

interface DisableFormState {
  roomId: RoomId;
  reason: string;
  date: string;
  start: string;
  end: string;
}

interface RuleFormState {
  roomId: RoomId;
  title: string;
  date: string;
  start: string;
  end: string;
}

interface ApiStatus {
  ok: boolean;
  message: string;
}

function toISODate(date: Date): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function todayISO(): string {
  return toISODate(new Date());
}

function addDays(date: Date, days: number): string {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return toISODate(nextDate);
}

function addHours(time: string, hours: number): string {
  const [hourText, minuteText] = time.split(':');
  const hour = Number.parseInt(hourText, 10) + hours;
  return `${String(hour).padStart(2, '0')}:${minuteText}`;
}

function formatRange(range?: TimeRange): string {
  if (!range) {
    return '未指定时段';
  }

  return `${range.start}—${range.end}`;
}

function getRoomById(state: DemoState, roomId: RoomId): Room | undefined {
  return state.rooms.find((room) => room.id === roomId);
}

function getMergedRoomById(state: DemoState, roomId: RoomId): MergedRoom | undefined {
  return state.mergedRooms.find((room) => room.id === roomId);
}

function getResourceById(state: DemoState, resourceId: RoomId): ResourceOption | undefined {
  const room = getRoomById(state, resourceId);
  if (room) {
    return {
      id: room.id,
      name: room.name,
      kind: 'room',
      capacity: room.capacity,
      status: room.status,
    };
  }

  const mergedRoom = getMergedRoomById(state, resourceId);
  if (mergedRoom) {
    return {
      id: mergedRoom.id,
      name: mergedRoom.name,
      kind: 'mergedRoom',
      capacity: mergedRoom.capacity,
      sourceRoomIds: mergedRoom.sourceRoomIds,
      status: mergedRoom.status,
    };
  }

  return undefined;
}

function getResources(state: DemoState): ResourceOption[] {
  return [
    ...state.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      kind: 'room' as const,
      capacity: room.capacity,
      status: room.status,
    })),
    ...state.mergedRooms.map((room) => ({
      id: room.id,
      name: room.name,
      kind: 'mergedRoom' as const,
      capacity: room.capacity,
      sourceRoomIds: room.sourceRoomIds,
      status: room.status,
    })),
  ];
}

function getFirstActiveResourceId(state: DemoState): RoomId {
  return getResources(state).find((resource) => resource.status === 'active')?.id ?? state.rooms[0]?.id ?? '';
}

function formatResultMessage(result: BusinessResult | null): string {
  if (!result) {
    return '';
  }

  return result.message;
}

function getActiveDynamicRoomIds(state: DemoState): RoomId[] {
  return [...new Set(state.dynamicDisables.filter((dynamic) => dynamic.active).map((dynamic) => dynamic.roomId))];
}

function parseWeekday(text: string): number | undefined {
  const match = text.match(/([一二三四五六日天])/);
  if (!match) {
    return undefined;
  }

  const mapping: Record<string, number> = {
    日: 0,
    天: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
  };

  return mapping[match[1]];
}

function parseDate(text: string): string {
  const today = new Date();
  const todayText = toISODate(today);
  const yearMonthDay = text.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (yearMonthDay) {
    return `${yearMonthDay[1]}-${String(Number(yearMonthDay[2])).padStart(2, '0')}-${String(Number(yearMonthDay[3])).padStart(2, '0')}`;
  }

  const monthDay = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (monthDay) {
    return `${todayText.slice(0, 5)}${String(Number(monthDay[1])).padStart(2, '0')}-${String(Number(monthDay[2])).padStart(2, '0')}`;
  }

  if (text.includes('明天')) {
    return addDays(today, 1);
  }

  if (text.includes('后天')) {
    return addDays(today, 2);
  }

  if (text.includes('今天')) {
    return todayText;
  }

  const weekdayMatch = text.match(/(本周|这周|下周|下礼拜|这礼拜)?\s*(周|星期)([一二三四五六日天])/);
  if (weekdayMatch) {
    const weekday = parseWeekday(weekdayMatch[3]);
    if (weekday === undefined) {
      return todayText;
    }

    const prefix = weekdayMatch[1] ?? '';
    const currentWeekday = new Date(todayText).getUTCDay();
    if (prefix === '下周' || prefix === '下礼拜') {
      return addDays(today, 7 + ((weekday - currentWeekday + 7) % 7));
    }

    return addDays(today, (weekday - currentWeekday + 7) % 7);
  }

  return todayText;
}

function normalizeTime(hourText: string, minuteText: string | undefined, period: string | undefined): string {
  let hour = Number.parseInt(hourText, 10);
  const minute = minuteText ? Number.parseInt(minuteText, 10) : 0;

  if (period === '下午' || period === '晚上') {
    hour += 12;
  }

  if (period === '中午' && hour < 12) {
    hour = 12;
  }

  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) {
    return '';
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function extractTimeMentions(text: string): string[] {
  const times: string[] = [];
  const addTime = (time: string) => {
    if (time && !times.includes(time)) {
      times.push(time);
    }
  };

  const colonRegex = /(\d{1,2}):(\d{2})/g;
  for (const match of text.matchAll(colonRegex)) {
    addTime(normalizeTime(match[1], match[2], undefined));
  }

  const hourRegex = /(上午|下午|中午|晚上)?\s*(\d{1,2})(?:点|时)(\d{1,2})?分?/g;
  for (const match of text.matchAll(hourRegex)) {
    addTime(normalizeTime(match[2], match[3], match[1]));
  }

  return times;
}

function parseTimeRange(text: string): TimeRange | undefined {
  if (text.includes('全天')) {
    return { start: '00:00', end: '24:00' };
  }

  if (text.includes('中午')) {
    return { start: '12:00', end: '13:30' };
  }

  const times = extractTimeMentions(text);
  if (times.length >= 2) {
    return { start: times[0], end: times[1] };
  }

  if (times.length === 1) {
    return { start: times[0], end: addHours(times[0], 1) };
  }

  return undefined;
}

function addUniqueRoomId(roomIds: RoomId[], roomId: RoomId): void {
  if (!roomIds.includes(roomId)) {
    roomIds.push(roomId);
  }
}

function extractRoomIds(text: string, state: DemoState): RoomId[] {
  const roomIds: RoomId[] = [];
  const hasMergedAlias = /大会议室|合并会议室|会议室一\/二|会议室一二|会议室一和会议室二|会议室一.*会议室二/.test(text);
  const mergedRoom = getMergedRoomById(state, 'meeting-room-1-2');

  if (hasMergedAlias) {
    addUniqueRoomId(roomIds, mergedRoom?.id ?? 'meeting-room-1-2');
    return roomIds;
  }

  if (text.includes('活动室')) {
    addUniqueRoomId(roomIds, 'activity-room');
  }

  if (text.includes('小会议室')) {
    SMALL_ROOM_IDS.forEach((roomId) => addUniqueRoomId(roomIds, roomId));
  }

  if (text.includes('503')) {
    addUniqueRoomId(roomIds, 'room-503');
  }

  if (text.includes('505')) {
    addUniqueRoomId(roomIds, 'room-505');
  }

  if (text.includes('506')) {
    addUniqueRoomId(roomIds, 'room-506');
  }

  if (text.includes('会议室一')) {
    addUniqueRoomId(roomIds, 'meeting-room-1');
  }

  if (text.includes('会议室二')) {
    addUniqueRoomId(roomIds, 'meeting-room-2');
  }

  return roomIds;
}

function extractTitle(text: string, fallback: string): string {
  const match = text.match(/(?:预约|创建|订|规则|标题)[:：]?\s*([^，,。]+?)(?:，|,|。|$)/);
  return match?.[1].trim() || fallback;
}

function extractOrganizer(text: string): string | undefined {
  const match = text.match(/(?:组织者|组织人|发起人)[:：]?\s*([^，,。]+?)(?:，|,|。|$)/);
  return match?.[1].trim() || undefined;
}

function makeLocalIntent(text: string, state: DemoState): StructuredIntent {
  const normalizedText = text.trim().replace(/\s+/g, ' ');
  const date = parseDate(normalizedText);
  const range = parseTimeRange(normalizedText);
  const roomIds = extractRoomIds(normalizedText, state);
  let action: StructuredIntent['action'] = 'unknown';
  let actorRole: StructuredIntent['actorRole'] = 'unknown';
  const title = extractTitle(normalizedText, '自然语言意图');

  if (/取消|退订/.test(normalizedText)) {
    action = 'cancelBooking';
    actorRole = 'member';
  } else if (/合并/.test(normalizedText)) {
    action = 'mergeRooms';
    actorRole = 'admin';
  } else if (/拆分|分开|取消合并/.test(normalizedText)) {
    action = 'unmergeRooms';
    actorRole = 'admin';
  } else if (/启用|恢复/.test(normalizedText)) {
    action = 'dynamicEnableRoom';
    actorRole = 'admin';
  } else if (/规则|不可预约/.test(normalizedText)) {
    action = 'configureRule';
    actorRole = 'admin';
  } else if (/禁用|停用|维修|不能预约/.test(normalizedText)) {
    action = 'dynamicDisableRoom';
    actorRole = 'admin';
  } else if (/预约|创建|订/.test(normalizedText)) {
    action = 'createBooking';
    actorRole = 'member';
  } else if (/查询|可用|查/.test(normalizedText)) {
    action = 'queryAvailability';
    actorRole = 'member';
  }

  return {
    id: `local-intent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    actorRole,
    rawText: normalizedText,
    entities: {
      ...(roomIds.length > 0 ? { roomIds } : {}),
      ...(date ? { date } : {}),
      ...(range ? { range } : {}),
      ...(actorRole === 'member' ? { organizer: { name: extractOrganizer(normalizedText) ?? 'member' } } : {}),
      ...(title ? { title } : {}),
    },
    constraints: {},
    createdAt: new Date().toISOString(),
  };
}

function summarizeIntentAction(action: StructuredIntent['action']): string {
  const labels: Record<StructuredIntent['action'], string> = {
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

function makeErrorResult(message: string): BusinessResult {
  return {
    id: `error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'failed',
    message,
    createdAt: new Date().toISOString(),
  };
}

export default function App() {
  const [demoState, setDemoState] = useState<DemoState | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus>({ ok: false, message: '正在连接 API Server…' });
  const [activeTab, setActiveTab] = useState<'member' | 'admin'>('member');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [availabilityInput, setAvailabilityInput] = useState<AvailabilityFormState>({
    date: todayISO(),
    start: '10:00',
    end: '11:00',
  });
  const [availabilityResult, setAvailabilityResult] = useState<BusinessResult | null>(null);
  const [bookingForm, setBookingForm] = useState<BookingFormState>({
    roomId: '',
    title: '',
    organizer: '',
    date: todayISO(),
    start: '10:00',
    end: '11:00',
  });
  const [bookingResult, setBookingResult] = useState<BusinessResult | null>(null);
  const [naturalLanguageText, setNaturalLanguageText] = useState('帮我查下周二 10 点到 11 点可用的小会议室');
  const [naturalLanguageResult, setNaturalLanguageResult] = useState<BusinessResult | null>(null);
  const [naturalLanguageSummary, setNaturalLanguageSummary] = useState('');
  const [naturalLanguageIntent, setNaturalLanguageIntent] = useState<StructuredIntent | null>(null);
  const [disableForm, setDisableForm] = useState<DisableFormState>({
    roomId: 'activity-room',
    reason: '',
    date: todayISO(),
    start: '00:00',
    end: '24:00',
  });
  const [enableRoomId, setEnableRoomId] = useState<RoomId>('activity-room');
  const [ruleForm, setRuleForm] = useState<RuleFormState>({
    roomId: 'activity-room',
    title: '',
    date: todayISO(),
    start: '12:00',
    end: '13:30',
  });
  const [adminResult, setAdminResult] = useState<BusinessResult | null>(null);

  const refreshState = useCallback(async () => {
    try {
      const state = await fetchState();
      setDemoState(state);
      setApiStatus({ ok: true, message: `API Server 已连接 · ${state.rooms.length + state.mergedRooms.length} 个资源` });
    } catch (error) {
      setApiStatus({ ok: false, message: error instanceof Error ? error.message : 'API Server 连接失败。' });
    }
  }, []);

  useEffect(() => {
    refreshState().catch(() => undefined);
    fetchApiHealth().then(() => {
      setApiStatus({ ok: true, message: 'API Server 健康检查通过' });
    }).catch(() => {
      setApiStatus({ ok: false, message: 'API Server 未启动；请运行 npm run dev:api 后刷新页面。' });
    });
  }, [refreshState]);

  useEffect(() => {
    if (!demoState) {
      return;
    }

    if (!bookingForm.roomId || !getResourceById(demoState, bookingForm.roomId)) {
      setBookingForm((current) => ({ ...current, roomId: getFirstActiveResourceId(demoState) }));
    }

    if (!disableForm.roomId || !getRoomById(demoState, disableForm.roomId)) {
      setDisableForm((current) => ({ ...current, roomId: demoState.rooms[0]?.id ?? '' }));
    }

    if (!enableRoomId || !getActiveDynamicRoomIds(demoState).includes(enableRoomId)) {
      setEnableRoomId(getActiveDynamicRoomIds(demoState)[0] ?? demoState.rooms[0]?.id ?? '');
    }

    if (!ruleForm.roomId || !getRoomById(demoState, ruleForm.roomId)) {
      setRuleForm((current) => ({ ...current, roomId: demoState.rooms[0]?.id ?? '' }));
    }
  }, [demoState, bookingForm.roomId, disableForm.roomId, enableRoomId, ruleForm.roomId]);

  const handleQueryAvailability = async () => {
    setLoading(true);
    try {
      const result = await apiQueryAvailability({
        date: availabilityInput.date,
        range: { start: availabilityInput.start, end: availabilityInput.end },
        includeMergedRooms: true,
      });
      setAvailabilityResult(result);
      setMessage(formatResultMessage(result));
      await refreshState();
    } catch (error) {
      const result = makeErrorResult(error instanceof Error ? error.message : '可用性查询失败。');
      setAvailabilityResult(result);
      setMessage(result.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBooking = async () => {
    const selectedResource = getResourceById(demoState!, bookingForm.roomId);
    const input = {
      roomId: bookingForm.roomId,
      sourceRoomIds: selectedResource?.sourceRoomIds,
      title: bookingForm.title.trim() || '未命名预约',
      date: bookingForm.date,
      range: { start: bookingForm.start, end: bookingForm.end },
      organizer: { name: bookingForm.organizer.trim() || 'member' },
    };

    setLoading(true);
    try {
      const result = await apiCreateBooking(input, 'member');
      setBookingResult(result);
      setMessage(formatResultMessage(result));
      await refreshState();
    } catch (error) {
      const result = makeErrorResult(error instanceof Error ? error.message : '创建预约失败。');
      setBookingResult(result);
      setMessage(result.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelBooking = async (bookingId: string) => {
    setLoading(true);
    try {
      const result = await apiCancelBooking({ bookingId, reason: '用户在前端取消预约' }, 'member');
      setMessage(formatResultMessage(result));
      await refreshState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '取消预约失败。');
    } finally {
      setLoading(false);
    }
  };

  const handleDynamicDisable = async () => {
    setLoading(true);
    try {
      const result = await apiDynamicDisable({
        roomId: disableForm.roomId,
        reason: disableForm.reason.trim() || '管理员动态禁用',
        startDate: disableForm.date,
        endDate: disableForm.date,
        ranges: [{ start: disableForm.start, end: disableForm.end }],
      }, 'admin');
      setAdminResult(result);
      setMessage(formatResultMessage(result));
      await refreshState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '动态禁用失败。');
    } finally {
      setLoading(false);
    }
  };

  const handleDynamicEnable = async () => {
    setLoading(true);
    try {
      const result = await apiDynamicEnable(enableRoomId, 'admin');
      setAdminResult(result);
      setMessage(formatResultMessage(result));
      await refreshState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '动态启用失败。');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRule = async () => {
    setLoading(true);
    try {
      const result = await apiCreateRule({
        type: 'adminRule',
        scope: 'room',
        roomIds: [ruleForm.roomId],
        title: ruleForm.title.trim() || '临时不可预约规则',
        startDate: ruleForm.date,
        ranges: [{ start: ruleForm.start, end: ruleForm.end }],
        active: true,
      }, 'admin');
      setAdminResult(result);
      setMessage(formatResultMessage(result));
      await refreshState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '新增规则失败。');
    } finally {
      setLoading(false);
    }
  };

  const handleMergeRooms = async () => {
    const sourceRoomIds = ['meeting-room-1', 'meeting-room-2'].filter((roomId) => getRoomById(demoState!, roomId));
    setLoading(true);
    try {
      const result = await apiMergeRooms({
        sourceRoomIds,
        mergedRoomId: 'meeting-room-1-2',
        name: '会议室一/二合并',
        date: todayISO(),
        range: { start: '09:00', end: '18:00' },
      }, 'admin');
      setAdminResult(result);
      setMessage(formatResultMessage(result));
      await refreshState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '合并会议室失败。');
    } finally {
      setLoading(false);
    }
  };

  const handleSplitMergedRoom = async (mergedRoomId: RoomId) => {
    setLoading(true);
    try {
      const result = await apiUnmergeRooms(mergedRoomId, 'admin');
      setAdminResult(result);
      setMessage(formatResultMessage(result));
      await refreshState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '拆分合并会议室失败。');
    } finally {
      setLoading(false);
    }
  };

  const handleNaturalLanguageSubmit = async () => {
    setLoading(true);
    try {
      const fallbackIntent = makeLocalIntent(naturalLanguageText, demoState!);
      const agent = await queryAgentIntent(naturalLanguageText, 'unknown');
      const intent = agent.intent ?? fallbackIntent;
      setNaturalLanguageIntent(intent);
      setNaturalLanguageSummary(`Agent 解析：${summarizeIntentAction(intent.action)} · ${intent.rawText}`);
      const result = await apiExecuteIntent(intent);
      setNaturalLanguageResult(result);
      setMessage(formatResultMessage(result));
      await refreshState();
    } catch (error) {
      const result = makeErrorResult(error instanceof Error ? error.message : '自然语言执行失败。');
      setNaturalLanguageResult(result);
      setMessage(result.message);
    } finally {
      setLoading(false);
    }
  };

  const resources = useMemo(() => demoState ? getResources(demoState) : [], [demoState]);
  const confirmedBookings = demoState?.bookings.filter((booking) => booking.status === 'confirmed') ?? [];
  const activeDynamicRoomIds = demoState ? getActiveDynamicRoomIds(demoState) : [];
  const latestResults = demoState?.businessResults.slice(-8).reverse() ?? [];

  if (!demoState) {
    return (
      <div className="app-shell">
        <header className="hero">
          <div>
            <p className="eyebrow">North Hackathon Team4 · Meeting Ordering Demo</p>
            <h1>本地可运行会务系统 Demo</h1>
            <p className="hero-description">正在从 API Server 恢复会议室、预约、规则和动态禁用状态。</p>
          </div>
        </header>
        <ConflictMessage result={makeErrorResult(apiStatus.message)} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">North Hackathon Team4 · Meeting Ordering Demo</p>
          <h1>API Server 驱动的会务系统 Demo</h1>
          <p className="hero-description">
            前端自然语言输入会先调用 Agent 解析，再通过 API Server 的 /api/intents/execute 执行业务意图；所有状态来自 API Server + SQLite。
          </p>
        </div>
        <div className="hero-actions">
          <span className="mode-pill">{apiStatus.ok ? 'API Server 已连接' : 'API Server 未连接'}</span>
          <span className="mode-pill">SQLite 持久化</span>
          <button className="secondary-button" type="button" onClick={() => refreshState().catch(() => undefined)} disabled={loading}>
            刷新状态
          </button>
        </div>
      </header>

      <section className="notice-panel">
        <strong>当前分支：</strong>demo/chenyu。前端不再直接写 localStorage；刷新页面后会从 API Server 恢复真实业务状态。
        <br />
        <span className="hint-text">{apiStatus.message}</span>
      </section>

      {message ? <ConflictMessage result={makeErrorResult(message)} /> : null}

      <nav className="tabs" aria-label="Demo 主导航">
        <button className={activeTab === 'member' ? 'tab-button active' : 'tab-button'} type="button" onClick={() => setActiveTab('member')}>
          成员预约
        </button>
        <button className={activeTab === 'admin' ? 'tab-button active' : 'tab-button'} type="button" onClick={() => setActiveTab('admin')}>
          管理员模式
        </button>
      </nav>

      {activeTab === 'member' ? (
        <main className="grid-layout">
          <section className="panel wide-panel">
            <MeetingRoomsPanel
              rooms={demoState.rooms}
              mergedRooms={demoState.mergedRooms}
              bookings={demoState.bookings}
              dynamicDisables={demoState.dynamicDisables}
              rules={demoState.unavailabilityRules}
            />
          </section>

          <section className="panel">
            <NaturalLanguageInput
              text={naturalLanguageText}
              onChange={setNaturalLanguageText}
              onSubmit={handleNaturalLanguageSubmit}
              result={naturalLanguageResult}
              summary={naturalLanguageSummary}
              intent={naturalLanguageIntent}
            />
          </section>

          <section className="panel">
            <AvailabilitySearch
              input={availabilityInput}
              onChange={setAvailabilityInput}
              onSearch={handleQueryAvailability}
              result={availabilityResult}
            />
          </section>

          <section className="panel">
            <BookingForm
              resources={resources}
              form={bookingForm}
              onChange={setBookingForm}
              onCreate={handleCreateBooking}
              result={bookingResult}
            />
          </section>

          <section className="panel wide-panel">
            <BookingList bookings={demoState.bookings} state={demoState} onCancel={handleCancelBooking} />
          </section>

          <section className="panel wide-panel">
            <BusinessResultPanel results={latestResults} />
          </section>
        </main>
      ) : (
        <main className="grid-layout">
          <section className="panel">
            <AdminPanel
              rooms={demoState.rooms}
              mergedRooms={demoState.mergedRooms}
              disableForm={disableForm}
              onDisableFormChange={setDisableForm}
              enableRoomId={enableRoomId}
              onEnableRoomIdChange={setEnableRoomId}
              ruleForm={ruleForm}
              onRuleFormChange={setRuleForm}
              activeDynamicRoomIds={activeDynamicRoomIds}
              confirmedBookings={confirmedBookings}
              rules={demoState.unavailabilityRules}
              result={adminResult}
              onDynamicDisable={handleDynamicDisable}
              onDynamicEnable={handleDynamicEnable}
              onCreateRule={handleCreateRule}
              onMergeRooms={handleMergeRooms}
              onSplitMergedRoom={handleSplitMergedRoom}
            />
          </section>

          <section className="panel wide-panel">
            <MeetingRoomsPanel
              rooms={demoState.rooms}
              mergedRooms={demoState.mergedRooms}
              bookings={demoState.bookings}
              dynamicDisables={demoState.dynamicDisables}
              rules={demoState.unavailabilityRules}
            />
          </section>

          <section className="panel wide-panel">
            <BusinessResultPanel results={latestResults} />
          </section>
        </main>
      )}
    </div>
  );
}

export {
  WEEKDAY_LABELS,
  addDays,
  extractRoomIds,
  formatRange,
  parseDate,
  parseTimeRange,
  summarizeIntentAction,
  todayISO,
};
