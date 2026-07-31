import { parseStructuredIntent } from './agentClient';
import type { StructuredIntent } from '../types';

export function parseLocalIntent(input: string, actorRole?: 'admin' | 'member' | 'unknown'): StructuredIntent {
  return parseStructuredIntent(input, actorRole);
}
