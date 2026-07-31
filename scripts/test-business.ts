#!/usr/bin/env tsx
import { createMeetingDatabase } from '../src/db/meetingDatabase';
import { executeBusinessIntent } from '../src/services/meetingBusiness';
import type { StructuredIntent } from '../src/types';

function buildIntent(input: string, action: StructuredIntent['action'], actorRole: 'admin' | 'member' = 'member'): StructuredIntent {
  const date = new Date();
  if (input.includes('明天')) date.setDate(date.getDate() + 1);
  if (input.includes('本周五')) {
    date.setDate(date.getDate() + ((5 - date.getDay() + 7) % 7));
  }

  const dateText = date.toISOString().slice(0, 10);
  const entities: StructuredIntent['entities'] = {
    ...(input.includes('活动室') ? { roomIds: ['activity-room'] } : {}),
    ...(input.includes('会议室一') ? { roomIds: ['meeting-room-1', 'meeting-room-2'] } : {}),
    ...(input.includes('明天') ? { date: dateText } : {}),
    ...(input.includes('本周五') ? { date: dateText } : {}),
    ...(input.includes('14:00') ? { range: { start: '14:00', end: '16:00' } } : {}),
    ...(input.includes('中午') ? { range: { start: '12:00', end: '13:30' } } : {}),
  };
  const constraints: StructuredIntent['constraints'] = action === 'mergeRooms'
    ? { sourceRoomIds: ['meeting-room-1', 'meeting-room-2'], mergedRoomId: 'meeting-room-1-2' }
    : {};

  return {
    id: `intent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    actorRole,
    rawText: input,
    entities,
    constraints,
    createdAt: new Date().toISOString(),
  };
}

const database = createMeetingDatabase();

try {
  database.seedDemoData(true);
  const state = database.loadDemoState();

  const lunchResult = executeBusinessIntent(state, buildIntent('明天中午预约活动室开会', 'createBooking', 'member'));
  if (lunchResult.status !== 'success') {
    console.log('scenario-lunch-blocked', lunchResult.status, lunchResult.message);
  } else {
    throw new Error('activity-room lunch rule did not block booking');
  }

  const mergeResult = executeBusinessIntent(state, buildIntent('本周五 14:00 到 16:00 合并会议室一和会议室二', 'mergeRooms', 'admin'));
  console.log('scenario-merge', mergeResult.status, mergeResult.message);

  const roomsResult = executeBusinessIntent(state, buildIntent('会议室列表', 'listRooms', 'member'));
  console.log('scenario-rooms', roomsResult.status, Array.isArray(roomsResult.data) ? 'bad' : 'ok');

  console.log(JSON.stringify({
    ok: true,
    databasePath: database.databasePath,
    counts: database.getTableCounts(),
  }, null, 2));
} finally {
  database.close();
}
