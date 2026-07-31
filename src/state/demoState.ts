import type {
  AdminOperation,
  Booking,
  BusinessResult,
  DemoState,
  DynamicDisablement,
  MergedRoom,
  Room,
  StructuredIntent,
  UnavailabilityRule,
} from '../types';

type NodeFs = {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  mkdirSync(path: string, options: { recursive: boolean }): void;
};

type NodePath = {
  dirname(path: string): string;
  resolve(...paths: string[]): string;
};

declare const require: {
  (moduleId: string): unknown;
};

const DEMO_STATE_STORAGE_KEY = 'north-hackathon-team4-demo-state';

export const DEFAULT_DEMO_STATE_FILE = 'demo-state.json';

export const demoStateVersion = 1;

export function createInitialDemoState(): DemoState {
  const now = new Date().toISOString();

  const rooms: Room[] = [
    {
      id: 'activity-room',
      name: '活动室',
      location: '办公楼',
      capacity: 20,
      equipment: ['投影', '音响'],
      status: 'active',
    },
    {
      id: 'meeting-room-1',
      name: '会议室一',
      location: '办公楼',
      capacity: 10,
      equipment: ['投影', '白板'],
      status: 'active',
      canMergeWith: ['meeting-room-2'],
    },
    {
      id: 'meeting-room-2',
      name: '会议室二',
      location: '办公楼',
      capacity: 10,
      equipment: ['投影', '白板'],
      status: 'active',
      canMergeWith: ['meeting-room-1'],
    },
    {
      id: 'room-503',
      name: '503',
      location: '5 楼',
      capacity: 6,
      equipment: ['白板'],
      status: 'active',
    },
    {
      id: 'room-505',
      name: '505',
      location: '5 楼',
      capacity: 6,
      equipment: ['白板'],
      status: 'active',
    },
    {
      id: 'room-506',
      name: '506',
      location: '5 楼',
      capacity: 6,
      equipment: ['白板'],
      status: 'active',
    },
  ];

  const mergedRooms: MergedRoom[] = [
    {
      id: 'meeting-room-1-2',
      name: '会议室一/二合并',
      location: '办公楼',
      capacity: 20,
      equipment: ['投影', '白板'],
      status: 'active',
      sourceRoomIds: ['meeting-room-1', 'meeting-room-2'],
      mergedRoomId: 'meeting-room-1-2',
    },
  ];

  const unavailabilityRules: UnavailabilityRule[] = [
    {
      id: 'activity-room-lunch-block',
      type: 'lunch',
      scope: 'room',
      roomIds: ['activity-room'],
      title: '活动室午餐时段不可预约',
      description: '活动室中午作为餐厅，午餐时段不能预约会议。',
      weekdays: [1, 2, 3, 4, 5],
      ranges: [
        {
          start: '12:00',
          end: '13:30',
        },
      ],
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'room-505-tuesday-block',
      type: 'weeklyUnavailable',
      scope: 'room',
      roomIds: ['room-505'],
      title: '505 每周二全天不可用',
      description: '505 每周二全天不可用。',
      weekdays: [2],
      ranges: [
        {
          start: '00:00',
          end: '24:00',
        },
      ],
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const dynamicDisables: DynamicDisablement[] = [];

  const adminOperations: AdminOperation[] = [];
  const businessResults: BusinessResult[] = [];
  const intents: StructuredIntent[] = [];
  const bookings: Booking[] = [];

  return {
    version: demoStateVersion,
    updatedAt: now,
    rooms,
    mergedRooms,
    bookings,
    unavailabilityRules,
    dynamicDisables,
    adminOperations,
    businessResults,
    intents,
  };
}

function isBrowserEnvironment(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function getLocalStorage(): Storage | undefined {
  if (!isBrowserEnvironment()) {
    return undefined;
  }

  return window.localStorage;
}

function requireNodeFs(): NodeFs {
  const mod = require('node:fs');
  if (!mod || typeof mod !== 'object') {
    throw new Error('无法在 Node 环境中加载 fs 模块。');
  }

  return mod as NodeFs;
}

function requireNodePath(): NodePath {
  const mod = require('node:path');
  if (!mod || typeof mod !== 'object') {
    throw new Error('无法在 Node 环境中加载 path 模块。');
  }

  return mod as NodePath;
}

function isBrowserStoragePath(filePath: string): boolean {
  return filePath === 'localStorage' || (filePath === DEFAULT_DEMO_STATE_FILE && isBrowserEnvironment());
}

function readBrowserStorage(filePath: string): DemoState | undefined {
  const storage = getLocalStorage();
  if (!storage || !isBrowserStoragePath(filePath)) {
    return undefined;
  }

  const raw = storage.getItem(DEMO_STATE_STORAGE_KEY);
  if (!raw) {
    return undefined;
  }

  return JSON.parse(raw) as DemoState;
}

function writeBrowserStorage(state: DemoState, filePath: string): void {
  const storage = getLocalStorage();
  if (!storage || !isBrowserStoragePath(filePath)) {
    throw new Error(`当前环境不支持写入 ${filePath}。`);
  }

  storage.setItem(DEMO_STATE_STORAGE_KEY, JSON.stringify(state, null, 2));
}

function normalizeState(state: DemoState): DemoState {
  return {
    ...state,
    version: demoStateVersion,
    updatedAt: new Date().toISOString(),
  };
}

function parseState(raw: string): DemoState {
  const parsed = JSON.parse(raw) as DemoState;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('demo-state.json 不是有效的对象。');
  }

  return parsed;
}

export function readDemoStateFile(filePath: string = DEFAULT_DEMO_STATE_FILE): DemoState {
  if (isBrowserStoragePath(filePath)) {
    const storedState = readBrowserStorage(filePath);
    if (storedState) {
      return storedState;
    }

    const state = createInitialDemoState();
    saveDemoState(state, filePath);
    return state;
  }

  const fs = requireNodeFs();
  if (!fs.existsSync(filePath)) {
    const state = createInitialDemoState();
    saveDemoState(state, filePath);
    return state;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  return parseState(raw);
}

export function saveDemoState(state: DemoState, filePath: string = DEFAULT_DEMO_STATE_FILE): void {
  const nextState = normalizeState(state);

  if (isBrowserStoragePath(filePath)) {
    writeBrowserStorage(nextState, filePath);
    return;
  }

  const path = requireNodePath();
  const fs = requireNodeFs();
  const directory = path.dirname(filePath);
  if (directory) {
    fs.mkdirSync(directory, { recursive: true });
  }

  fs.writeFileSync(filePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
}

export function loadDemoState(filePath: string = DEFAULT_DEMO_STATE_FILE): DemoState {
  return readDemoStateFile(filePath);
}

export function resetDemoState(filePath: string = DEFAULT_DEMO_STATE_FILE): DemoState {
  const state = createInitialDemoState();
  saveDemoState(state, filePath);
  return state;
}

export function ensureDemoStateFile(filePath: string = DEFAULT_DEMO_STATE_FILE): DemoState {
  return loadDemoState(filePath);
}
