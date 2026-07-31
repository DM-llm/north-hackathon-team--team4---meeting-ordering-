#!/usr/bin/env tsx
import { createMeetingDatabase } from '../src/db/meetingDatabase';

const reset = process.argv.includes('--reset');
const database = createMeetingDatabase();
try {
  const state = database.seedDemoData(reset);
  console.log(JSON.stringify({ ok: true, reset, databasePath: database.databasePath, counts: database.getTableCounts(), rooms: state.rooms.map((room) => ({ id: room.id, name: room.name })) }, null, 2));
} finally {
  database.close();
}
