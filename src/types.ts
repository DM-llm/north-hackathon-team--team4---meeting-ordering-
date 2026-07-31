export type RoomId = string;
export type BookingId = string;
export type RuleId = string;
export type OperationId = string;
export type IntentId = string;
export type BusinessResultId = string;
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type DateString = string;
export type TimeString = string;

export interface TimeRange {
  start: TimeString;
  end: TimeString;
}

export interface WeeklyAvailability {
  weekdays: Weekday[];
  ranges: TimeRange[];
}

export type RoomStatus = 'active' | 'inactive';

export interface Room {
  id: RoomId;
  name: string;
  location?: string;
  capacity?: number;
  equipment?: string[];
  status: RoomStatus;
  canMergeWith?: RoomId[];
  mergedRoomId?: RoomId;
  defaultAvailability?: WeeklyAvailability;
  createdAt?: string;
  updatedAt?: string;
}

export interface MergedRoom extends Room {
  sourceRoomIds: RoomId[];
}

export type UnavailabilityRuleType = 'lunch' | 'weeklyUnavailable' | 'temporaryMaintenance' | 'adminRule' | 'mergedRoomBlock';
export type UnavailabilityRuleScope = 'room' | 'mergedRoom' | 'roomGroup';

export interface UnavailabilityRule {
  id: RuleId;
  type: UnavailabilityRuleType;
  scope: UnavailabilityRuleScope;
  roomIds: RoomId[];
  title: string;
  description?: string;
  startDate?: DateString;
  endDate?: DateString;
  weekdays?: Weekday[];
  ranges: TimeRange[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DynamicDisablement {
  id: OperationId;
  roomId: RoomId;
  reason: string;
  startDate: DateString;
  endDate?: DateString;
  ranges: TimeRange[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BookingStatus = 'confirmed' | 'cancelled' | 'adjusted' | 'rejected';

export interface BookingAttendee {
  name: string;
  email?: string;
}

export interface Booking {
  id: BookingId;
  roomId: RoomId;
  sourceRoomIds?: RoomId[];
  title: string;
  description?: string;
  organizer: BookingAttendee;
  attendees?: BookingAttendee[];
  date: DateString;
  range: TimeRange;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  adjustedAt?: string;
  rejectionReason?: string;
}

export type AdminOperationType = 'createRoom' | 'updateRoom' | 'createRule' | 'updateRule' | 'deleteRule' | 'dynamicDisable' | 'dynamicEnable' | 'forceAdjustBooking' | 'cancelBooking';

export interface AdminOperation {
  id: OperationId;
  type: AdminOperationType;
  actor: string;
  targetId?: string;
  summary: string;
  details?: unknown;
  createdAt: string;
}

export type BusinessResultStatus = 'success' | 'failed' | 'conflict' | 'notFound';

export interface BusinessResult {
  id: BusinessResultId;
  status: BusinessResultStatus;
  message: string;
  data?: unknown;
  createdAt: string;
  updatedAt?: string;
}

export type StructuredIntentAction = 'listRooms' | 'queryAvailability' | 'createBooking' | 'cancelBooking' | 'configureRoom' | 'configureRule' | 'updateRule' | 'deleteRule' | 'dynamicDisableRoom' | 'dynamicEnableRoom' | 'mergeRooms' | 'unmergeRooms' | 'adjustBooking' | 'unknown';

export interface StructuredIntent {
  id: IntentId;
  action: StructuredIntentAction;
  actorRole: 'admin' | 'member' | 'unknown';
  rawText: string;
  entities?: {
    roomIds?: RoomId[];
    roomNames?: string[];
    date?: DateString;
    range?: TimeRange;
    title?: string;
    organizer?: BookingAttendee;
    attendees?: BookingAttendee[];
    bookingId?: BookingId;
    ruleId?: RuleId;
    reason?: string;
    capacity?: number;
    location?: string;
    equipment?: string[];
  };
  constraints?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

export interface QueryAvailabilityInput {
  date: string;
  range?: TimeRange;
  roomIds?: RoomId[];
  roomNames?: string[];
  capacity?: number;
  includeMergedRooms?: boolean;
}

export interface CreateBookingInput {
  roomId: RoomId;
  sourceRoomIds?: RoomId[];
  title: string;
  date: string;
  range: TimeRange;
  organizer: BookingAttendee;
  attendees?: BookingAttendee[];
  description?: string;
}

export interface DynamicDisableInput {
  roomId: RoomId;
  reason: string;
  startDate: string;
  endDate?: string;
  ranges: TimeRange[];
  active?: boolean;
}

export interface RuleInput {
  id?: RuleId;
  type: UnavailabilityRuleType;
  scope: UnavailabilityRuleScope;
  roomIds: RoomId[];
  title: string;
  description?: string;
  startDate?: DateString;
  endDate?: DateString;
  weekdays?: Weekday[];
  ranges: TimeRange[];
  active?: boolean;
}

export interface DemoState {
  version: number;
  updatedAt: string;
  rooms: Room[];
  mergedRooms: MergedRoom[];
  bookings: Booking[];
  unavailabilityRules: UnavailabilityRule[];
  dynamicDisables: DynamicDisablement[];
  adminOperations: AdminOperation[];
  businessResults: BusinessResult[];
  intents: StructuredIntent[];
}
