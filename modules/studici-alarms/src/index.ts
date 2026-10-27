import { requireOptionalNativeModule } from 'expo-modules-core';

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
}

export const StudICIAlarms =
  requireOptionalNativeModule<StudICIAlarmsNativeModule>('StudICIAlarms');
