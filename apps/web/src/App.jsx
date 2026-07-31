import { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

const DEMO_USER = {
  id: 'demo-admin',
  name: 'Demo 管理员',
  role: 'admin',
};

const MEMBER_USER = {
  id: 'demo-member',
  name: 'Demo 成员',
  role: 'member',
};

const DEFAULT_ROOMS = [
  {
    id: 'activity',
    name: '活动室',
    type: 'activity',
    location: '1F 北侧',
    capacity: 30,
    equipment: ['投影', '音响', '移动桌椅'],
    status: 'available',
    note: '中午作为餐厅，午餐时段不可预约会议',
  },
  {
    id: 'room1',
    name: '会议室一',
    type: 'meeting',
    location: '2F A区',
    capacity: 12,
    equipment: ['投影', '白板', '视频会议'],
    status: 'available',
    note: '可与会议室二合并成大会议室',
  },
  {
    id: 'room2',
    name: '会议室二',
    type: 'meeting',
    location: '2F A区',
    capacity: 12,
    equipment: ['投影', '白板', '视频会议'],
    status: 'available',
    note: '可与会议室一合并成大会议室',
  },
  {
    id: 'room503',
    name: '503',
    type: 'small',
    location: '5F 东侧',
    capacity: 6,
    equipment: ['白板', '投屏'],
    status: 'available',
    note: '小会议室',
  },
  {
    id: 'room505',
    name: '505',
    type: 'small',
    location: '5F 东侧',
    capacity: 6,
    equipment: ['白板', '投屏'],
    status: 'blocked',
    note: '每周二全天不可用',
  },
  {
    id: 'room506',
    name: '506',
    type: 'small',
    location: '5F 东侧',
    capacity: 6,
    equipment: ['白板', '投屏'],
    status: 'available',
    note: '小会议室',
  },
  {
    id: 'combined-room1-room2',
    name: '会议室一+会议室二',
    type: 'combined',
    location: '2F A区 合并空间',
    capacity: 24,
    equipment: ['投影', '白板', '视频会议'],
    status: 'available',
    note: '由会议室一和会议室二合并',
  },
];

const FLOOR_PLAN = [
  { x: 50, y: 40, width: 150, height: 110, roomId: 'activity' },
  { x: 230, y: 40, width: 110, height: 110, roomId: 'room1' },
  { x: 350, y: 40, width: 110, height: 110, roomId: 'room2' },
  { x: 50, y: 190, width: 100, height: 110, roomId: 'room503' },
  { x: 170, y: 190, width: 100, height: 110, roomId: 'room505' },
  { x: 290, y: 190, width: 100, height: 110, roomId: 'room506' },
  { x: 420, y: 190, width: 100, height: 110, roomId: 'combined-room1-room2' },
];

const DEMO_SCENARIOS = [
  {
    title: '查询下周二小会议室',
    message: '下周二 10:00—11:00 想约一间小会议室开项目讨论，帮我看看有哪些可以用。',
  },
  {
    title: '活动室午餐冲突',
    message: '明天中午 12:00-13:00 想预约活动室开项目同步会。',
  },
  {
    title: '合并大会议室',
    message: '本周五 14:00-16:00 要开一场大会议，帮我把会议室一和会议室二合并使用。',
  },
  {
    title: '临时维修全天禁用',
    message: '这周三 504 临时维修，全天不能预约。',
  },
  {
    title: '修改维修规则到下午',
    message: '刚才说错了，504 临时维修只停用下午 14:00-18:00。',
  },
];

const RULE_TYPES = [
  { value: 'temporary_unavailable', label: '临时不可预约' },
  { value: 'lunch_block', label: '午餐占用' },
  { value: 'weekly_unavailable', label: '周期不可用' },
];

const INTENT_LABELS = {
  query_availability: '查询可用',
  create_reservation: '创建预约',
  cancel_reservation: '取消预约',
  create_rule: '新增规则',
  update_rule: '修改规则',
  delete_rule: '删除规则',
  admin_update_reservation: '管理员调整预约',
  admin_force_update_reservation: '强制调整预约',
  unknown: '待确认',
};

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getToday() {
  return formatDate(new Date());
}

function getTomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return formatDate(date);
}

function getRelativeDate(keyword) {
  const today = new Date();
  const currentDay = today.getDay();
  const dayMap = {
    日: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
  };
  const match = keyword.match(/(本|下)?周([一二三四五六日天])/);
  if (!match) {
    return getToday();
  }
  const isNext = match[1] === '下';
  const targetDay = dayMap[match[2]] ?? 1;
  const offset = targetDay - currentDay + (isNext ? 7 : 0);
  const date = new Date(today);
  date.setDate(today.getDate() + (offset === 0 && !isNext ? 0 : offset));
  return formatDate(date);
}

function getThisWeekday(dayName) {
  const dayMap = {
    周一: 1,
    周二: 2,
    周三: 3,
    周四: 4,
    周五: 5,
    周六: 6,
    周日: 0,
  };
  const today = new Date();
  const currentDay = today.getDay();
  const targetDay = dayMap[dayName] ?? 1;
  const offset = targetDay - currentDay + (targetDay <= currentDay ? 7 : 0);
  const date = new Date(today);
  date.setDate(today.getDate() + offset);
  return formatDate(date);
}

function getCombinedRooms(rooms) {
  return rooms.find((room) => room.id === 'combined-room1-room2')
    ? rooms
    : [
        ...rooms,
        {
          id: 'combined-room1-room2',
          name: '会议室一+会议室二',
          type: 'combined',
          location: '2F A区 合并空间',
          capacity: 24,
          equipment: ['投影', '白板', '视频会议'],
          status: 'available',
          note: '由会议室一和会议室二合并',
        },
      ];
}

function getRoomById(rooms, roomId) {
  return getCombinedRooms(rooms).find((room) => room.id === roomId);
}

function normalizeMessageText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractTimeRange(text) {
  const match = text.match(/(\d{1,2})[:：](\d{2})\s*(?:—|-|到|至)\s*(\d{1,2})[:：](\d{2})/);
  if (!match) {
    return { startTime: '10:00', endTime: '11:00', hasTimeRange: false };
  }
  return {
    startTime: `${String(match[1]).padStart(2, '0')}:${match[2]}`,
    endTime: `${String(match[3]).padStart(2, '0')}:${match[4]}`,
    hasTimeRange: true,
  };
}

function inferIntent(text, role) {
  const normalized = normalizeMessageText(text);
  if (!normalized) return 'unknown';
  if (/查询|看看|哪些可以用|可用|有没有/.test(normalized)) return 'query_availability';
  if (/取消|撤销|退订/.test(normalized)) return 'cancel_reservation';
  if (/规则|不能预约|不可预约|停用|禁用|维修|午餐/.test(normalized)) {
    if (/删除|取消规则|撤销规则|移除/.test(normalized)) return 'delete_rule';
    if (/刚才说错|修改|改成|只停用|更新/.test(normalized)) return 'update_rule';
    return 'create_rule';
  }
  if (/预约|预订|订一下|帮我约/.test(normalized)) {
    if (role === 'admin' && /强制|调整|改到/.test(normalized)) return 'admin_force_update_reservation';
    return 'create_reservation';
  }
  if (/管理员|调整|改到|强制/.test(normalized)) return 'admin_update_reservation';
  return 'unknown';
}

function inferParams(text, role, currentDate, rooms) {
  const normalized = normalizeMessageText(text);
  const { startTime, endTime, hasTimeRange } = extractTimeRange(normalized);
  const roomMap = getCombinedRooms(rooms);
  let roomId = null;
  let targetRooms = [];
  let roomType = null;

  for (const room of roomMap) {
    if (normalized.includes(room.name)) {
      roomId = room.id;
      break;
    }
  }

  if (/小会议室|小会|项目讨论/.test(normalized)) roomType = 'small';
  if (/大会议|大会议室|合并/.test(normalized)) {
    roomType = 'combined';
    roomId = 'combined-room1-room2';
    targetRooms = ['room1', 'room2'];
  }
  if (/活动室|午餐/.test(normalized)) {
    roomType = 'activity';
    roomId = 'activity';
  }
  if (/503|504|505|506/.test(normalized)) {
    const match = normalized.match(/(503|504|505|506)/);
    if (match) {
      roomId = `room${match[1]}`;
      roomType = 'small';
    }
  }

  let date = currentDate;
  if (/明天/.test(normalized)) date = getTomorrow();
  if (/本周五|周五/.test(normalized)) date = getThisWeekday('周五');
  if (/下周二|周二/.test(normalized)) date = getRelativeDate(normalized);
  if (/这周三|周三/.test(normalized)) date = getThisWeekday('周三');

  const reasonMatch = normalized.match(/原因[:：]\s*([^，。]+)/);
  const titleMatch = normalized.match(/(?:会议|预约|讨论|项目|同步|培训|评审)[:：]?\s*([^，。]+)/);

  return {
    room_id: roomId,
    room_type: roomType,
    date,
    start_time: hasTimeRange ? startTime : (roomType ? startTime : '00:00'),
    end_time: hasTimeRange ? endTime : (roomType ? endTime : '23:59'),
    title: titleMatch?.[1] || 'Agent 自然语言会议',
    organizer: role === 'admin' ? DEMO_USER.name : MEMBER_USER.name,
    attendees: /大会议|合并/.test(normalized) ? 20 : 6,
    capacity_min: /大会议|合并/.test(normalized) ? 20 : 4,
    equipment: /投影/.test(normalized) ? ['投影'] : [],
    rule_id: null,
    target_rooms: targetRooms,
    reason: reasonMatch?.[1] || /维修|停用|禁用/.test(normalized) ? '临时规则' : null,
    force: /强制/.test(normalized),
  };
}

function buildAgentPayload(text, role, currentDate, rooms, context) {
  const intent = inferIntent(text, role);
  const params = inferParams(text, role, currentDate, rooms);
  return {
    message: normalizeMessageText(text),
    role,
    current_date: currentDate,
    context: {
      selected_date: context.selectedDate,
      selected_time: context.selectedTime,
      selected_room_id: context.selectedRoomId,
    },
    structured_intent: {
      intent,
      role_required: role,
      parameters: params,
      explanation: getExplanation(intent, params),
      confidence: 0.82,
    },
  };
}

function getExplanation(intent, params) {
  if (intent === 'query_availability') {
    return `已抽取 ${params.date} ${params.start_time}-${params.end_time} 的可用空间查询条件。`;
  }
  if (intent === 'create_reservation') {
    return `已抽取预约请求：${params.date} ${params.start_time}-${params.end_time}，目标空间 ${params.room_id || params.room_type || '待补充'}。`;
  }
  if (intent === 'cancel_reservation') {
    return '已识别为取消预约请求，请从下方预约列表选择要取消的记录。';
  }
  if (intent === 'create_rule') {
    return '已识别为新增不可预约规则请求，将由后端规则引擎校验并写入状态。';
  }
  if (intent === 'update_rule') {
    return '已识别为修改规则请求，优先更新最近一条同目标规则。';
  }
  if (intent === 'admin_update_reservation' || intent === 'admin_force_update_reservation') {
    return '已识别为管理员调整预约请求，后端会记录审计日志。';
  }
  return '已收到自然语言输入，后端 Agent 将返回结构化意图和可执行操作。';
}

async function apiRequest(path, options = {}) {
  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    data = text ? { text } : null;
  }

  if (!response.ok) {
    const message = data?.message || data?.error || data?.detail || response.statusText;
    throw new Error(message);
  }
  return data;
}

function firstArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return value.data || value.items || value.rooms || value.reservations || value.rules || value.audit_logs || value.logs || [];
}

function StatusBadge({ status, children }) {
  const className = `status-badge status-${status || 'unknown'}`;
  return <span className={className}>{children}</span>;
}

function SectionTitle({ eyebrow, title, children }) {
  return (
    <div className="section-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function App() {
  const [role, setRole] = useState('member');
  const [user, setUser] = useState(MEMBER_USER);
  const [rooms, setRooms] = useState(() => getCombinedRooms(DEFAULT_ROOMS));
  const [reservations, setReservations] = useState([]);
  const [rules, setRules] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [selectedTime, setSelectedTime] = useState('10:00');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'system',
      text: '欢迎使用 North Hackathon 会务系统。切换到管理员/成员角色，输入自然语言即可完成查询、预约、规则配置和管理员调整。',
      createdAt: new Date().toISOString(),
    },
  ]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    type: 'temporary_unavailable',
    target_room_id: 'room503',
    start_at: '',
    end_at: '',
    reason: '',
    recurrence: 'none',
  });
  const [reservationForm, setReservationForm] = useState({
    space_id: 'room503',
    date: getToday(),
    start_time: '10:00',
    end_time: '11:00',
    title: '项目讨论',
    description: '由前端表单创建的预约',
    attendees: 4,
  });
  const [activeRuleId, setActiveRuleId] = useState('');
  const [activeReservationId, setActiveReservationId] = useState('');
  const [forceAdjust, setForceAdjust] = useState(false);
  const [flash, setFlash] = useState('');

  const currentUser = useMemo(() => (role === 'admin' ? DEMO_USER : MEMBER_USER), [role]);

  useEffect(() => {
    setUser(currentUser);
  }, [currentUser]);

  useEffect(() => {
    const date = new Date();
    const currentDay = date.getDay();
    const targetDay = 2;
    const offset = targetDay - currentDay + (targetDay <= currentDay ? 7 : 0);
    date.setDate(date.getDate() + offset);
    setSelectedDate(formatDate(date));
    setSelectedTime('10:00');
  }, []);

  useEffect(() => {
    if (flash) {
      const timer = setTimeout(() => setFlash(''), 3200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [flash]);

  const refreshAll = useCallback(async () => {
    try {
      const [roomsData, reservationsData, rulesData, auditData] = await Promise.all([
        apiRequest('/rooms'),
        apiRequest('/reservations'),
        apiRequest('/rules'),
        apiRequest('/audit-log'),
      ]);
      setRooms(getCombinedRooms(firstArray(roomsData)));
      setReservations(firstArray(reservationsData));
      setRules(firstArray(rulesData));
      setAuditLogs(firstArray(auditData));
    } catch (err) {
      setFlash(`API 未连接或返回异常：${err.message}`);
    }
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const selectedRoom = useMemo(() => getRoomById(rooms, selectedRoomId), [rooms, selectedRoomId]);

  const handleRoleChange = (nextRole) => {
    setRole(nextRole);
    const nextUser = nextRole === 'admin' ? DEMO_USER : MEMBER_USER;
    setUser(nextUser);
    setFlash(`${nextUser.name} 已切换`);
  };

  const sendAgentMessage = async () => {
    const text = message.trim();
    if (!text) return;
    const intent = inferIntent(text, role);
    const params = inferParams(text, role, selectedDate, rooms);
    const structuredId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-agent`;
    const resultId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-result`;
    const payload = buildAgentPayload(text, role, selectedDate, rooms, { selectedDate, selectedTime, selectedRoomId });
    const outgoing = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };
    const structured = {
      id: structuredId,
      role: 'system',
      text: `结构化意图：${INTENT_LABELS[intent] || intent}\n${getExplanation(intent, params)}`,
      payload,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, outgoing, structured]);
    setMessage('');
    setAgentLoading(true);
    try {
      const result = await apiRequest('/agent/message', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const responseText = typeof result?.reply === 'string' ? result.reply : JSON.stringify(result, null, 2);
      const resultSummary = `业务结果：${responseText.slice(0, 180)}${responseText.length > 180 ? '...' : ''}`;
      setMessages((prev) => [
        ...prev.map((item) => (item.id === structuredId ? { ...item, text: `${item.text}\n${resultSummary}` } : item)),
        {
          id: resultId,
          role: 'assistant',
          text: responseText,
          payload: result,
          createdAt: new Date().toISOString(),
        },
      ]);
      await refreshAll();
      setFlash('Agent 请求已执行，列表、日历、平面图和审计日志已刷新');
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-error`,
          role: 'system',
          text: `请求失败：${err.message}`,
          createdAt: new Date().toISOString(),
        },
      ]);
      setFlash(`请求失败：${err.message}`);
    } finally {
      setAgentLoading(false);
    }
  };

  const createRule = async () => {
    const payload = {
      type: ruleForm.type,
      target_room_id: ruleForm.target_room_id,
      start_at: ruleForm.start_at || `${ruleForm.target_room_id === 'activity' ? selectedDate : selectedDate}T12:00:00`,
      end_at: ruleForm.end_at || `${ruleForm.target_room_id === 'activity' ? selectedDate : selectedDate}T13:30:00`,
      reason: ruleForm.reason || '管理员控制台新增规则',
      recurrence: ruleForm.recurrence || 'none',
      source: 'admin',
      created_by: user.id,
    };
    const path = activeRuleId ? `/rules/${activeRuleId}` : '/rules';
    const method = activeRuleId ? 'PATCH' : 'POST';
    const result = await apiRequest(path, { method, body: JSON.stringify(payload) });
    setFlash(activeRuleId ? '规则已修改' : '规则已新增');
    setActiveRuleId('');
    setRuleForm({
      type: 'temporary_unavailable',
      target_room_id: 'room503',
      start_at: '',
      end_at: '',
      reason: '',
      recurrence: 'none',
    });
    await refreshAll();
    return result;
  };

  const deleteRule = async (ruleId) => {
    await apiRequest(`/rules/${ruleId}`, { method: 'DELETE' });
    setFlash('规则已删除');
    if (activeRuleId === ruleId) setActiveRuleId('');
    await refreshAll();
  };

  const editRule = async (rule) => {
    setActiveRuleId(rule.id);
    const startAt = rule.start_at || rule.start_time || '';
    const endAt = rule.end_at || rule.end_time || '';
    setRuleForm({
      type: rule.type || 'temporary_unavailable',
      target_room_id: rule.target_room_id || rule.room_id || '',
      start_at: startAt ? startAt.slice(0, 16).replace('T', ' ') : '',
      end_at: endAt ? endAt.slice(0, 16).replace('T', ' ') : '',
      reason: rule.reason || '',
      recurrence: rule.recurrence || 'none',
    });
    setFlash('已载入规则，可修改后保存');
  };

  const createReservation = async () => {
    const result = await apiRequest('/reservations', {
      method: 'POST',
      body: JSON.stringify({
        ...reservationForm,
        organizer_id: user.id,
        created_by: user.id,
      }),
    });
    setFlash('预约已创建');
    await refreshAll();
    return result;
  };

  const cancelReservation = async (reservationId) => {
    await apiRequest(`/reservations/${reservationId}`, { method: 'DELETE' });
    setFlash('预约已取消');
    if (activeReservationId === reservationId) setActiveReservationId('');
    await refreshAll();
  };

  const updateReservation = async () => {
    if (!activeReservationId) return;
    const method = forceAdjust ? 'PATCH' : 'PATCH';
    const result = await apiRequest(`/reservations/${activeReservationId}`, {
      method,
      body: JSON.stringify({
        ...reservationForm,
        organizer_id: user.id,
        updated_by: user.id,
        force: forceAdjust,
        reason: forceAdjust ? '管理员强制调整' : '管理员控制台修改预约',
      }),
    });
    setFlash(forceAdjust ? '预约已强制调整' : '预约已修改');
    setActiveReservationId('');
    setForceAdjust(false);
    await refreshAll();
    return result;
  };

  const editReservation = (reservation) => {
    setActiveReservationId(reservation.id);
    setReservationForm({
      space_id: reservation.space_id || reservation.room_id || 'room503',
      date: reservation.date || reservation.start_at?.slice(0, 10) || getToday(),
      start_time: reservation.start_time || reservation.start_at?.slice(11, 16) || '10:00',
      end_time: reservation.end_time || reservation.end_at?.slice(11, 16) || '11:00',
      title: reservation.title || '项目讨论',
      description: reservation.description || '管理员调整预约',
      attendees: reservation.attendees || 4,
    });
    setFlash('已载入预约，可修改后保存');
  };

  const resetDemo = async () => {
    const result = await apiRequest('/demo/reset', { method: 'POST', body: JSON.stringify({ seed: true }) });
    setFlash('Demo 数据已重置');
    await refreshAll();
    return result;
  };

  const runScenario = async (scenario) => {
    setMessage(scenario.message);
    const intent = inferIntent(scenario.message, role);
    const params = inferParams(scenario.message, role, selectedDate, rooms);
    if (intent === 'create_rule') {
      setRuleForm({
        type: 'temporary_unavailable',
        target_room_id: params.room_id || 'room503',
        start_at: params.start_time ? `${params.date} ${params.start_time}` : '',
        end_at: params.end_time ? `${params.date} ${params.end_time}` : '',
        reason: params.reason || '临时维修',
        recurrence: 'none',
      });
      setFlash('已填入规则表单，可点击新增规则');
      return;
    }
    if (intent === 'update_rule') {
      const latest = [...rules].reverse().find((item) => item.target_room_id === params.room_id || item.room_id === params.room_id);
      if (latest) {
        await editRule(latest);
      } else {
        setRuleForm({
          type: 'temporary_unavailable',
          target_room_id: params.room_id || 'room503',
          start_at: params.start_time ? `${params.date} ${params.start_time}` : '',
          end_at: params.end_time ? `${params.date} ${params.end_time}` : '',
          reason: '临时维修下午',
          recurrence: 'none',
        });
        setFlash('未找到最近规则，已填入新规则表单');
      }
      return;
    }
    if (intent === 'create_reservation') {
      setReservationForm({
        space_id: params.room_id || 'room503',
        date: params.date,
        start_time: params.start_time,
        end_time: params.end_time,
        title: params.title,
        description: scenario.message,
        attendees: params.attendees,
      });
      setFlash('已填入预约表单，可点击创建预约');
      return;
    }
    setSelectedDate(params.date);
    setSelectedTime(params.start_time);
    setMessage(scenario.message);
    await sendAgentMessage();
  };

  const selectFloorRoom = (roomId) => {
    setSelectedRoomId(roomId);
    if (role === 'admin') {
      setRuleForm((current) => ({
        ...current,
        target_room_id: roomId,
      }));
      setFlash(`已选择 ${getRoomById(rooms, roomId)?.name || roomId}，可新增或修改不可预约规则`);
    } else {
      setFlash(`已选择 ${getRoomById(rooms, roomId)?.name || roomId}，切换到管理员可编辑规则`);
    }
  };

  const isHourSelected = (slotHour) => {
    if (!slotHour || !selectedTime) return false;
    const [slotHourValue] = slotHour.split(':').map(Number);
    const [selectedHourValue] = selectedTime.split(':').map(Number);
    return slotHourValue === selectedHourValue;
  };

  const timeline = useMemo(() => {
    const hours = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
    return hours.map((hour) => ({
      hour,
      items: getCombinedRooms(rooms).map((room) => {
        const overlaps = [];
        const roomReservations = reservations.filter((item) => {
          const itemDate = item.date || item.start_at?.slice(0, 10);
          return itemDate === selectedDate && (item.space_id === room.id || item.room_id === room.id) && item.status !== 'cancelled';
        });
        const roomRules = rules.filter((item) => {
          const itemDate = item.date || item.start_at?.slice(0, 10);
          return itemDate === selectedDate && (item.target_room_id === room.id || item.room_id === room.id);
        });
        roomReservations.forEach((reservation) => {
          if (isOverlap(hour, reservation.start_time || reservation.start_at?.slice(11, 16), reservation.end_time || reservation.end_at?.slice(11, 16))) {
            overlaps.push({ type: '占用', text: reservation.title, className: 'occupied' });
          }
        });
        roomRules.forEach((rule) => {
          if (isOverlap(hour, rule.start_time || rule.start_at?.slice(11, 16), rule.end_time || rule.end_at?.slice(11, 16))) {
            overlaps.push({ type: '禁用', text: rule.reason || rule.type, className: 'blocked' });
          }
        });
        return overlaps;
      }),
    }));
  }, [rooms, reservations, rules, selectedDate]);

  const floorPlanStatus = useMemo(() => {
    const status = {};
    getCombinedRooms(rooms).forEach((room) => {
      status[room.id] = 'available';
    });
    reservations.forEach((reservation) => {
      const date = reservation.date || reservation.start_at?.slice(0, 10);
      if (date === selectedDate && reservation.status !== 'cancelled') {
        status[reservation.space_id || reservation.room_id] = 'occupied';
      }
    });
    rules.forEach((rule) => {
      const date = rule.date || rule.start_at?.slice(0, 10);
      if (date === selectedDate) {
        status[rule.target_room_id || rule.room_id] = 'blocked';
      }
    });
    return status;
  }, [rooms, reservations, rules, selectedDate]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div>
            <h1>North Hackathon 会务系统</h1>
            <p>Agent 驱动的会议室查询、预约、规则配置与管理员调整</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="role-switcher" aria-label="角色切换">
            <button className={role === 'member' ? 'active' : ''} type="button" onClick={() => handleRoleChange('member')}>
              成员
            </button>
            <button className={role === 'admin' ? 'active' : ''} type="button" onClick={() => handleRoleChange('admin')}>
              管理员
            </button>
          </div>
          <div className="user-chip">
            <span>{user.name}</span>
            <small>{user.role === 'admin' ? 'Administrator' : 'Member'}</small>
          </div>
        </div>
      </header>

      {flash && <div className="flash">{flash}</div>}

      <main className="main-grid">
        <section className="panel agent-panel">
          <SectionTitle eyebrow="Agent" title="自然语言对话">
            <button className="ghost-button" type="button" onClick={refreshAll}>
              刷新状态
            </button>
          </SectionTitle>
          <div className="chat-window">
            {messages.map((item) => (
              <article className={`chat-bubble ${item.role}`} key={item.id}>
                <pre className="chat-pre">{item.text}</pre>
              </article>
            ))}
            {agentLoading && <div className="chat-bubble system">Agent 正在调用后端...</div>}
          </div>
          <div className="agent-input-row">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="例如：本周五 14:00-16:00 要开一场大会议，帮我把会议室一和会议室二合并使用。"
              rows={3}
            />
            <button className="primary-button" type="button" onClick={sendAgentMessage} disabled={agentLoading || !message.trim()}>
              {agentLoading ? '发送中' : '发送'}
            </button>
          </div>
          <div className="scenario-grid">
            {DEMO_SCENARIOS.map((scenario) => (
              <button className="scenario-button" type="button" onClick={() => runScenario(scenario)} key={scenario.title}>
                {scenario.title}
              </button>
            ))}
            <button className="danger-button" type="button" onClick={resetDemo}>
              重置 Demo 数据
            </button>
          </div>
        </section>

        <section className="panel room-panel">
          <SectionTitle eyebrow="Rooms" title="会议室列表">
            <span className="muted-text">当前状态</span>
          </SectionTitle>
          <div className="room-list">
            {getCombinedRooms(rooms).map((room) => (
              <article
                className={`room-card ${selectedRoomId === room.id ? 'selected' : ''}`}
                key={room.id}
                onClick={() => setSelectedRoomId(room.id)}
                tabIndex={0}
                role="button"
              >
                <div className="room-card-header">
                  <h3>{room.name}</h3>
                  <StatusBadge status={floorPlanStatus[room.id] || room.status}>{roomStatusText(floorPlanStatus[room.id] || room.status)}</StatusBadge>
                </div>
                <p>{room.location}</p>
                <div className="meta-row">
                  <span>容量 {room.capacity}</span>
                  <span>{room.equipment?.join(' / ')}</span>
                </div>
                <small>{room.note}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="panel calendar-panel">
          <SectionTitle eyebrow="Calendar" title="日历 / 时段视图">
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </SectionTitle>
          <div className="calendar-controls">
            <input type="time" value={selectedTime} onChange={(event) => setSelectedTime(event.target.value)} />
            <select value={selectedRoomId} onChange={(event) => setSelectedRoomId(event.target.value)}>
              <option value="">全部空间</option>
              {getCombinedRooms(rooms).map((room) => (
                <option value={room.id} key={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </div>
          <div className="timeline">
            <div className="timeline-head">
              <div>空间</div>
              <div className="timeline-hours">
                {timeline[0]?.hour && timeline.map((slot) => <span key={slot.hour}>{slot.hour}</span>)}
              </div>
            </div>
            {getCombinedRooms(rooms)
              .filter((room) => !selectedRoomId || room.id === selectedRoomId)
              .map((room) => (
                <div className="timeline-row" key={room.id}>
                  <div className="timeline-room">
                    <strong>{room.name}</strong>
                    <small>{room.capacity} 人</small>
                  </div>
                  <div className="timeline-cells">
                    {timeline.map((slot) => {
                      const index = getCombinedRooms(rooms).findIndex((item) => item.id === room.id);
                      const items = slot.items[index] || [];
                      const item = items.find((entry) => entry.className === 'blocked') || items.find((entry) => entry.className === 'occupied');
                      return (
                        <div className={`timeline-cell ${item?.className || ''} ${isHourSelected(slot.hour) ? 'selected-hour' : ''}`} key={`${room.id}-${slot.hour}`} title={item?.text || `${room.name} ${slot.hour}`}>
                          {item && <span>{item.text}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        </section>

        <section className="panel floor-panel">
          <SectionTitle eyebrow="Floor Plan" title="可编辑平面图">
            <span className="muted-text">点击房间编辑规则</span>
          </SectionTitle>
          <svg className="floor-plan" viewBox="0 0 560 340" role="img" aria-label="会议室平面图">
            <rect x="0" y="0" width="560" height="340" rx="24" className="floor-bg" />
            {FLOOR_PLAN.map((item) => {
              const room = getRoomById(rooms, item.roomId);
              const status = floorPlanStatus[item.roomId] || room?.status || 'available';
              return (
                <g key={item.roomId} onClick={() => selectFloorRoom(item.roomId)} className="floor-node">
                  <rect x={item.x} y={item.y} width={item.width} height={item.height} rx="18" className={`floor-rect ${status}`} />
                  <text x={item.x + item.width / 2} y={item.y + 34} textAnchor="middle" className="floor-title">
                    {room?.name}
                  </text>
                  <text x={item.x + item.width / 2} y={item.y + 62} textAnchor="middle" className="floor-meta">
                    {room?.capacity}人 / {roomStatusText(status)}
                  </text>
                  <text x={item.x + item.width / 2} y={item.y + 86} textAnchor="middle" className="floor-equipment">
                    {room?.equipment?.[0]}
                  </text>
                </g>
              );
            })}
          </svg>
          {selectedRoom && (
            <div className="selected-room">
              <h3>{selectedRoom.name}</h3>
              <p>{selectedRoom.location}</p>
              <div className="meta-row">
                <span>容量 {selectedRoom.capacity}</span>
                <span>{selectedRoom.equipment?.join(' / ')}</span>
              </div>
              <p>{selectedRoom.note}</p>
            </div>
          )}
        </section>

        <section className="panel admin-panel">
          <SectionTitle eyebrow="Admin" title="管理员控制台">
            <span className="muted-text">{role === 'admin' ? '当前为管理员' : '请切换到管理员'}</span>
          </SectionTitle>
          <div className="admin-grid">
            <form className="form-card" onSubmit={(event) => { event.preventDefault(); createRule(); }}>
              <h3>不可预约规则</h3>
              <label>
                规则类型
                <select value={ruleForm.type} onChange={(event) => setRuleForm({ ...ruleForm, type: event.target.value })}>
                  {RULE_TYPES.map((item) => (
                    <option value={item.value} key={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                目标空间
                <select value={ruleForm.target_room_id} onChange={(event) => setRuleForm({ ...ruleForm, target_room_id: event.target.value })}>
                  {getCombinedRooms(rooms).map((room) => (
                    <option value={room.id} key={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                开始时间
                <input type="datetime-local" value={ruleForm.start_at} onChange={(event) => setRuleForm({ ...ruleForm, start_at: event.target.value })} />
              </label>
              <label>
                结束时间
                <input type="datetime-local" value={ruleForm.end_at} onChange={(event) => setRuleForm({ ...ruleForm, end_at: event.target.value })} />
              </label>
              <label>
                原因
                <input value={ruleForm.reason} onChange={(event) => setRuleForm({ ...ruleForm, reason: event.target.value })} placeholder="临时维修 / 午餐占用 / 活动占用" />
              </label>
              <label>
                周期
                <select value={ruleForm.recurrence} onChange={(event) => setRuleForm({ ...ruleForm, recurrence: event.target.value })}>
                  <option value="none">无</option>
                  <option value="weekly">每周</option>
                  <option value="daily">每日</option>
                </select>
              </label>
              <div className="form-actions">
                <button className="primary-button" type="submit" disabled={role !== 'admin'}>
                  {activeRuleId ? '保存修改' : '新增规则'}
                </button>
                {activeRuleId && <button className="ghost-button" type="button" onClick={() => setActiveRuleId('')}>取消编辑</button>}
              </div>
            </form>

            <form className="form-card" onSubmit={(event) => { event.preventDefault(); createReservation(); }}>
              <h3>预约管理</h3>
              <label>
                空间
                <select value={reservationForm.space_id} onChange={(event) => setReservationForm({ ...reservationForm, space_id: event.target.value })}>
                  {getCombinedRooms(rooms).map((room) => (
                    <option value={room.id} key={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                日期
                <input type="date" value={reservationForm.date} onChange={(event) => setReservationForm({ ...reservationForm, date: event.target.value })} />
              </label>
              <label>
                开始时间
                <input type="time" value={reservationForm.start_time} onChange={(event) => setReservationForm({ ...reservationForm, start_time: event.target.value })} />
              </label>
              <label>
                结束时间
                <input type="time" value={reservationForm.end_time} onChange={(event) => setReservationForm({ ...reservationForm, end_time: event.target.value })} />
              </label>
              <label>
                标题
                <input value={reservationForm.title} onChange={(event) => setReservationForm({ ...reservationForm, title: event.target.value })} />
              </label>
              <label>
                描述
                <textarea value={reservationForm.description} onChange={(event) => setReservationForm({ ...reservationForm, description: event.target.value })} />
              </label>
              <label>
                人数
                <input type="number" min="1" value={reservationForm.attendees} onChange={(event) => setReservationForm({ ...reservationForm, attendees: Number(event.target.value) })} />
              </label>
              <div className="form-actions">
                <button className="primary-button" type="submit">创建预约</button>
                {activeReservationId && <button className="primary-button" type="button" onClick={updateReservation}>保存调整</button>}
                {activeReservationId && <label className="check-row"><input type="checkbox" checked={forceAdjust} onChange={(event) => setForceAdjust(event.target.checked)} /> 强制调整</label>}
              </div>
            </form>
          </div>

          <div className="table-card">
            <h3>规则列表</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>空间</th>
                    <th>时间</th>
                    <th>原因</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.length === 0 && (
                    <tr>
                      <td colSpan="5">暂无规则</td>
                    </tr>
                  )}
                  {rules.map((rule) => (
                    <tr key={rule.id}>
                      <td>{rule.type}</td>
                      <td>{getRoomById(rooms, rule.target_room_id || rule.room_id)?.name || rule.target_room_id || rule.room_id}</td>
                      <td>{formatRuleTime(rule)}</td>
                      <td>{rule.reason}</td>
                      <td className="table-actions">
                        <button type="button" onClick={() => editRule(rule)}>修改</button>
                        <button type="button" onClick={() => deleteRule(rule.id)}>删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="table-card">
            <h3>预约列表</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>空间</th>
                    <th>时间</th>
                    <th>标题</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.length === 0 && (
                    <tr>
                      <td colSpan="5">暂无预约</td>
                    </tr>
                  )}
                  {reservations.map((reservation) => (
                    <tr key={reservation.id}>
                      <td>{getRoomById(rooms, reservation.space_id || reservation.room_id)?.name || reservation.space_id || reservation.room_id}</td>
                      <td>
                        {reservation.date || reservation.start_at?.slice(0, 10)} {reservation.start_time || reservation.start_at?.slice(11, 16)} - {reservation.end_time || reservation.end_at?.slice(11, 16)}
                      </td>
                      <td>{reservation.title}</td>
                      <td>{reservation.status}</td>
                      <td className="table-actions">
                        <button type="button" onClick={() => editReservation(reservation)}>调整</button>
                        <button type="button" onClick={() => cancelReservation(reservation.id)}>取消</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="panel audit-panel">
          <SectionTitle eyebrow="Audit" title="审计日志">
            <button className="ghost-button" type="button" onClick={refreshAll}>刷新</button>
          </SectionTitle>
          <div className="audit-list">
            {auditLogs.length === 0 && <p className="empty-state">暂无审计日志</p>}
            {auditLogs.map((log) => (
              <article className="audit-item" key={log.id}>
                <div>
                  <strong>{log.action || log.event || log.type}</strong>
                  <small>{log.created_at || log.createdAt || log.time}</small>
                </div>
                <p>{log.message || log.detail || JSON.stringify(log, null, 2)}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function roomStatusText(status) {
  if (status === 'occupied') return '占用';
  if (status === 'blocked') return '禁用';
  if (status === 'available') return '可用';
  return '未知';
}

function isOverlap(hourStart, itemStart, itemEnd) {
  if (!hourStart || !itemStart || !itemEnd) return false;
  const [h1, m1] = hourStart.split(':').map(Number);
  const [h2, m2] = itemStart.split(':').map(Number);
  const [h3, m3] = itemEnd.split(':').map(Number);
  const hourMinutes = h1 * 60 + m1;
  const startMinutes = h2 * 60 + m2;
  const endMinutes = h3 * 60 + m3;
  return hourMinutes < endMinutes && hourMinutes + 60 > startMinutes;
}

function formatRuleTime(rule) {
  const start = rule.start_at || rule.start_time || '';
  const end = rule.end_at || rule.end_time || '';
  const startAt = start.includes('T') ? `${start.slice(0, 10)} ${start.slice(11, 16)}` : start;
  const endAt = end.includes('T') ? `${end.slice(0, 10)} ${end.slice(11, 16)}` : end;
  return `${startAt} - ${endAt}`;
}

export default App;
