import { requireOptionalNativeModule } from 'expo-modules-core';

export interface StructuredLocationEntry {
  eventId: string;
  title: string;
  latitude: number;
  longitude: number;
}

export interface FreshEventCalendar {
  id: string;
  title: string;
  allowsModifications: boolean;
  color?: string;
  source?: {
    id?: string;
    name?: string;
    type?: string;
  };
}

export interface StudICIAlarmsNativeModule {
  isAlarmKitSupported(): Promise<boolean>;
  requestAuthorization(): Promise<boolean>;
  cancelAllAlarms(): Promise<{ success: boolean; cancelledCount: number }>;
  scheduleWeeklyAlarm(
    weekday: number,
    hour: number,
    minute: number,
    title: string,
    subtitle: string,
    tintColorHex: string
  ): Promise<{ id: string; engine: 'alarmkit' | 'usernotifications' }>;
  attachStructuredLocations?(entries: StructuredLocationEntry[]): Promise<number>;
  getFreshEventCalendars?(): Promise<FreshEventCalendar[]>;
  updateEventCalendarMetadata?(
    calendarId: string,
    title: string | null,
    colorHex: string | null
  ): Promise<boolean>;
}

export const StudICIAlarms =
  requireOptionalNativeModule<StudICIAlarmsNativeModule>('StudICIAlarms');
