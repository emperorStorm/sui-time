export interface AnniversaryLike {
  id: string; kind: 'countdown' | 'anniversary' | 'birthday' | 'holiday'; title: string; date: string;
  notes: string; pinned: boolean; theme: 'sky' | 'warm' | 'night'; createdAt: number; updatedAt: number;
}
export interface AnniversaryState {
  nextDate: string; days: number; label: string; past: boolean; elapsedDays: number; elapsedText: string;
  age: number; nextAge: number; adjusted: boolean;
}
import type { AnniversaryOccurrence, AnniversaryRecord, AnniversaryRecordInput } from '../desktop-client/src/types'
export function anniversaryOccurrence(item: Pick<AnniversaryLike, 'id' | 'date' | 'kind' | 'title' | 'notes'>, date: string, record?: AnniversaryRecord | null): AnniversaryOccurrence
export function anniversaryOccurrences(items: AnniversaryLike[], startDate: string, endDate: string, records?: AnniversaryRecord[]): AnniversaryOccurrence[]
export function anniversaryRecordOccurrence(record: AnniversaryRecord, notes?: string): AnniversaryOccurrence
export function prepareAnniversaryRecord(item: AnniversaryLike, input: AnniversaryRecordInput, previous?: AnniversaryRecord | null, today?: string): AnniversaryRecord
export const anniversaryTypes: { value: AnniversaryLike['kind']; label: string; mark: string }[]
export const anniversaryThemes: { value: AnniversaryLike['theme']; label: string }[]
export const MAX_PHOTO_BYTES: number
export function localToday(): string
export function dateOrdinal(value: string): number
export function anniversaryState(item: Pick<AnniversaryLike, 'kind' | 'date'>, today?: string): AnniversaryState
export function orderedAnniversaries<T extends AnniversaryLike>(items: T[], today?: string): (T & { state: AnniversaryState })[]
export function normalizeAnniversary<T extends { id?: string; kind: AnniversaryLike['kind']; title: string; date: string; notes: string; pinned: boolean; theme: AnniversaryLike['theme']; photos: string[]; coverIndex: number }>(input: T, today?: string): T
