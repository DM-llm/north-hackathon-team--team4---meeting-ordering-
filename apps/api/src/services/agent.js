import { config } from '../config.js';
import {
  buildRelativeDate,
  buildTimeRange,
  getAvailableSpaces,
  getConflictsForSpace,
  normalizeSpaceId,
} from '../domain/rule-engine.js';
import { normalizeCombinedSpaceId, normalizeRoomId } from '../domain/normalizer.js';
import { parseTime } from '../domain/time.js';
import {
  cancelReservation,
  createReservation,
  createRule,
  deleteRule,
  getAvailability,
  latestReservationForSpace,
  latestRuleForTarget,
  listCombinedSpaces,
  listReservations,
  listRooms,
  listRules,
  updateReservation,
  updateRule,
} from '../services/business.js';

const SYSTEM_PROMPT = `你是 North Hackathon 会务系统 Agent。
你的职责是把用户自然语言转换为可执行 JSON 操作，而不是直接编造结果。
必须遵守：
1. 所有时间、日期、空间、规则最终由本地业务规则引擎校验。
2. 不要伪造预约成功或冲突结果。
3. 输出必须是 JSON 对象，字段包括 intent、parameters、explanation、confidence。
4. 支持查询可用、创建预约、取消预约、新增/修改/删除不可预约规则、管理员调整预约、强制调整预约。
5. 会议室一和会议室二可以合并为 combined-room1-room2。
6. 活动室午餐时段不可预约。
7. 505 每周二全天不可用。`;

export async function handleAgentMessage({ db, input, actor }) {
  const payload = normalizeAgentInput(input || {});
  const localIntent = inferLocalIntent(payload.message, actor.role, payload.structured_intent);
  const llmResult = await callNacAgent(payload, localIntent, actor);
  const structuredIntent = normalizeStructuredIntent(llmResult?.structured_intent || llmResult || localIntent, localIntent);
  const execution = await executeStructuredIntent({ db, intent: structuredIntent.intent, parameters: structuredIntent.parameters, actor });
  return {
    ok: true,
    agent: {
      runtime: llmResult?.runtime || 'local-fallback',
      model: config.model,
      confidence: structuredIntent.confidence,
      explanation: structuredIntent.explanation,
      raw: llmResult?.raw || null,
    },
    structured_intent: structuredIntent,
    ...execution,
    reply: `${structuredIntent.explanation}\n${execution.reply || ''}`,
  };
}

async function callNacAgent(payload, localIntent, actor) {
  if (!config.apiKey) {
    return {
      runtime: 'local-fallback',
      structured_intent: localIntent,
      raw: { fallback_reason: '缺少 OPENAI_API_KEY/NAC_API_KEY，使用本地确定性解析兜底。' },
    };
  }

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          actor,
          message: payload.message,
          current_date: payload.current_date,
          context: payload.context,
          rooms_hint: payload.rooms_hint,
          required_schema: {
            intent: 'query_availability|create_reservation|cancel_reservation|create_rule|update_rule|delete_rule|admin_update_reservation|admin_force_update_reservation',
            parameters: 'object',
            explanation: 'string',
            confidence: 'number 0-1',
          },
        }),
      },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  };

  try {
    const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        runtime: 'local-fallback',
        structured_intent: localIntent,
        raw: { fallback_reason: `NAC/LLM 请求失败：${response.status} ${text.slice(0, 300)}` },
      };
    }
    const json = await response.json();
    const content = json?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonContent(content);
    return {
      runtime: 'nac',
      structured_intent: parsed,
      raw: json,
    };
  } catch (error) {
    return {
      runtime: 'local-fallback',
      structured_intent: localIntent,
      raw: { fallback_reason: `NAC/LLM 请求异常：${error.message}` },
    };
  }
}

function normalizeAgentInput(input) {
  return {
    message: String(input.message || input.text || ''),
    role: input.role || input.actor_role || 'member',
    current_date: input.current_date || input.date || new Date().toISOString().slice(0, 10),
    context: input.context || {},
    rooms_hint: input.rooms_hint || input.rooms || [],
    structured_intent: input.structured_intent || null,
  };
}

function inferLocalIntent(text, role, structuredIntent) {
  if (structuredIntent?.intent) return structuredIntent;
  const normalized = String(text || '').trim();
  const date = buildRelativeDate(normalized, new Date().toISOString());
  const timeRange = buildTimeRange(normalized);
  let roomType = null;
  let roomId = null;
  let targetRooms = [];
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
  if (/会议室一/.test(normalized) && !/会议室二/.test(normalized)) {
    roomId = 'room1';
    roomType = 'meeting';
  }
  if (/会议室二/.test(normalized) && !/会议室一/.test(normalized)) {
    roomId = 'room2';
    roomType = 'meeting';
  }

  let intent = 'query_availability';
  if (/取消|撤销|退订/.test(normalized)) intent = 'cancel_reservation';
  else if (/规则|不能预约|不可预约|停用|禁用|维修|午餐/.test(normalized)) {
    if (/删除|取消规则|撤销规则|移除/.test(normalized)) intent = 'delete_rule';
    else if (/刚才说错|修改|改成|只停用|更新/.test(normalized)) intent = 'update_rule';
    else intent = 'create_rule';
  } else if (/预约|预订|订一下|帮我约/.test(normalized)) {
    if (role === 'admin' && /强制|调整|改到/.test(normalized)) intent = 'admin_force_update_reservation';
    else intent = 'create_reservation';
  } else if (/管理员|调整|改到/.test(normalized)) {
    intent = 'admin_update_reservation';
  }

  const reasonMatch = normalized.match(/原因[:：]\s*([^，。]+)/);
  const titleMatch = normalized.match(/(?:会议|预约|讨论|项目|同步|培训|评审)[:：]?\s*([^，。]+)/);

  return {
    intent,
    parameters: {
      room_id: roomId,
      room_type: roomType,
      date,
      start_time: timeRange.startTime,
      end_time: timeRange.endTime,
      title: titleMatch?.[1] || 'Agent 自然语言会议',
      organizer: role === 'admin' ? 'Demo 管理员' : 'Demo 成员',
      attendees: /大会议|合并/.test(normalized) ? 20 : 6,
      capacity_min: /大会议|合并/.test(normalized) ? 20 : 4,
      equipment: /投影/.test(normalized) ? ['投影'] : [],
      rule_id: null,
      target_rooms: targetRooms,
      reason: reasonMatch?.[1] || (/维修|停用|禁用/.test(normalized) ? '临时规则' : null),
      force: /强制/.test(normalized),
    },
    explanation: inferLocalExplanation(intent, roomId, date, timeRange),
    confidence: 0.72,
  };
}

function inferLocalExplanation(intent, roomId, date, timeRange) {
  if (intent === 'query_availability') return `本地 Agent 已抽取 ${date} ${timeRange.startTime}-${timeRange.endTime} 的可用空间查询条件。`;
  if (intent === 'create_reservation') return `本地 Agent 已抽取预约请求：${date} ${timeRange.startTime}-${timeRange.endTime}，目标空间 ${roomId || '待补充'}。`;
  if (intent === 'create_rule') return '本地 Agent 已识别为新增不可预约规则请求。';
  if (intent === 'update_rule') return '本地 Agent 已识别为修改最近同目标规则请求。';
  if (intent === 'delete_rule') return '本地 Agent 已识别为删除规则请求。';
  if (intent === 'cancel_reservation') return '本地 Agent 已识别为取消预约请求。';
  if (intent === 'admin_force_update_reservation') return '本地 Agent 已识别为管理员强制调整预约请求。';
  return '本地 Agent 已收到自然语言输入。';
}

function normalizeStructuredIntent(candidate, fallback) {
  const intent = candidate?.intent || fallback.intent;
  const parameters = candidate?.parameters || fallback.parameters || {};
  return {
    intent,
    parameters,
    explanation: candidate?.explanation || fallback.explanation,
    confidence: Number(candidate?.confidence || fallback.confidence || 0),
  };
}

async function executeStructuredIntent({ db, intent, parameters, actor }) {
  switch (intent) {
    case 'query_availability':
      return executeQueryAvailability(db, parameters, actor);
    case 'create_reservation':
      return executeCreateReservation(db, parameters, actor);
    case 'cancel_reservation':
      return executeCancelReservation(db, parameters, actor);
    case 'create_rule':
      return executeCreateRule(db, parameters, actor);
    case 'update_rule':
      return executeUpdateRule(db, parameters, actor);
    case 'delete_rule':
      return executeDeleteRule(db, parameters, actor);
    case 'admin_update_reservation':
      return executeAdminUpdateReservation(db, parameters, actor, false);
    case 'admin_force_update_reservation':
      return executeAdminUpdateReservation(db, parameters, actor, true);
    default:
      throw httpError(400, `暂不支持的 Agent 意图：${intent}`);
  }
}

async function executeQueryAvailability(db, parameters) {
  const filters = {
    room_type: parameters.room_type || null,
    capacity_min: Number(parameters.capacity_min || 0) || 0,
    equipment: Array.isArray(parameters.equipment) ? parameters.equipment : [],
  };
  const result = getAvailability(db, {
    date: parameters.date,
    start_time: parameters.start_time,
    end_time: parameters.end_time,
    filters,
    criteria: parameters.criteria || '',
  });
  return {
    ok: true,
    data: {
      available: result.available,
      unavailable: result.unavailable,
      date: result.date,
      start_time: result.start_time,
      end_time: result.end_time,
    },
    reply: result.reply,
  };
}

async function executeCreateReservation(db, parameters, actor) {
  const result = createReservation(db, {
    space_id: parameters.room_id,
    date: parameters.date,
    start_time: parameters.start_time,
    end_time: parameters.end_time,
    title: parameters.title,
    description: parameters.description || 'Agent 自然语言创建',
    attendees: parameters.attendees,
    organizer_id: actor.id,
    metadata: { source: 'agent', parameters },
  }, actor);
  return result;
}

async function executeCancelReservation(db, parameters, actor) {
  const reservationId = parameters.reservation_id || parameters.id;
  if (!reservationId) {
    const latest = latestReservationForSpace(db, parameters.room_id || parameters.space_id, parameters.date);
    if (!latest) throw httpError(404, '未找到可取消的预约，请提供预约 ID 或目标空间/日期。');
    return cancelReservation(db, latest.id, actor);
  }
  return cancelReservation(db, reservationId, actor);
}

async function executeCreateRule(db, parameters, actor) {
  const result = createRule(db, {
    type: parameters.type || 'temporary_unavailable',
    target_room_id: parameters.room_id || parameters.target_room_id,
    date: parameters.date,
    start_at: parameters.start_at,
    end_at: parameters.end_at,
    start_time: parameters.start_time,
    end_time: parameters.end_time,
    recurrence: parameters.recurrence || inferRecurrence(parameters),
    weekdays: parameters.weekdays || inferWeekdays(parameters),
    reason: parameters.reason || 'Agent 新增不可预约规则',
    source: 'agent',
    metadata: { source: 'agent', parameters },
  }, actor);
  return result;
}

async function executeUpdateRule(db, parameters, actor) {
  let ruleId = parameters.rule_id || parameters.id;
  if (!ruleId) {
    const latest = latestRuleForTarget(db, parameters.room_id || parameters.target_room_id);
    if (!latest) return executeCreateRule(db, parameters, actor);
    ruleId = latest.id;
  }
  const result = updateRule(db, ruleId, {
    type: parameters.type,
    target_room_id: parameters.room_id || parameters.target_room_id,
    start_at: parameters.start_at || (parameters.date && parameters.start_time ? `${parameters.date}T${parameters.start_time}:00` : undefined),
    end_at: parameters.end_at || (parameters.date && parameters.end_time ? `${parameters.date}T${parameters.end_time}:00` : undefined),
    start_time: parameters.start_time,
    end_time: parameters.end_time,
    recurrence: parameters.recurrence,
    weekdays: parameters.weekdays,
    reason: parameters.reason || 'Agent 修改不可预约规则',
    metadata: { source: 'agent', parameters },
  }, actor);
  return result;
}

async function executeDeleteRule(db, parameters, actor) {
  let ruleId = parameters.rule_id || parameters.id;
  if (!ruleId) {
    const latest = latestRuleForTarget(db, parameters.room_id || parameters.target_room_id);
    if (!latest) throw httpError(404, '未找到可删除的规则。');
    ruleId = latest.id;
  }
  return deleteRule(db, ruleId, actor);
}

async function executeAdminUpdateReservation(db, parameters, actor, force) {
  let reservationId = parameters.reservation_id || parameters.id;
  if (!reservationId) {
    const latest = latestReservationForSpace(db, parameters.room_id || parameters.space_id, parameters.date);
    if (!latest) throw httpError(404, '未找到可调整的预约。');
    reservationId = latest.id;
  }
  return updateReservation(db, reservationId, {
    space_id: parameters.room_id || parameters.space_id,
    date: parameters.date,
    start_at: parameters.start_at,
    end_at: parameters.end_at,
    start_time: parameters.start_time,
    end_time: parameters.end_time,
    title: parameters.title,
    description: parameters.description || 'Agent 管理员调整预约',
    force,
    reason: force ? '管理员强制调整' : '管理员调整预约',
    metadata: { source: 'agent', parameters, force },
  }, actor);
}

function inferRecurrence(parameters) {
  if (parameters.recurrence) return parameters.recurrence;
  if (/每天|每日/.test(parameters.reason || '')) return 'daily';
  if (/每周|周二|周一|周三|周四|周五|周六|周日/.test(parameters.reason || '')) return 'weekly';
  return 'none';
}

function inferWeekdays(parameters) {
  if (Array.isArray(parameters.weekdays)) return parameters.weekdays;
  const reason = parameters.reason || '';
  if (/周二/.test(reason)) return [2];
  if (/周一/.test(reason)) return [1];
  if (/周三/.test(reason)) return [3];
  if (/周四/.test(reason)) return [4];
  if (/周五/.test(reason)) return [5];
  if (/周六/.test(reason)) return [6];
  if (/周日|星期天/.test(reason)) return [0];
  return [];
}

function parseJsonContent(content) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function httpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}
