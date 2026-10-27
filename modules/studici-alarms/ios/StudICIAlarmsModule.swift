import ExpoModulesCore
import Foundation
import UserNotifications

#if canImport(AlarmKit)
import AlarmKit
import AppIntents
import SwiftUI

@available(iOS 26.0, *)
struct StudICIAlarmMetadata: AlarmMetadata, Codable, Hashable, Sendable {
  var title: String
  var subtitle: String?
  var alarmTime: String

  init(title: String, subtitle: String? = nil, alarmTime: String) {
    self.title = title
    self.subtitle = subtitle
    self.alarmTime = alarmTime
  }
}

@available(iOS 26.0, *)
public struct StudICIAlarmStopIntent: LiveActivityIntent {
  public static var title: LocalizedStringResource = "Ferma sveglia StudICI"
  public static var openAppWhenRun: Bool = false

  @Parameter(title: "alarmID")
  public var alarmIdentifier: String

  public init() {
    self.alarmIdentifier = ""
  }

  public init(alarmIdentifier: String) {
    self.alarmIdentifier = alarmIdentifier
  }

  public func perform() async throws -> some IntentResult {
    return .result()
  }
}
#endif

public class StudICIAlarmsModule: Module {
  private let storageKey = "StudICIAlarms.scheduledIds"

  public func definition() -> ModuleDefinition {
    Name("StudICIAlarms")

    AsyncFunction("isAlarmKitSupported") { () -> Bool in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        return true
      }
      #endif
      return false
    }

    AsyncFunction("requestAuthorization") { () -> Bool in
      var granted = false

      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        do {
          let state = try await AlarmManager.shared.requestAuthorization()
          if state == .authorized {
            granted = true
          }
        } catch {
          print("StudICIAlarms: AlarmKit authorization error: \(error)")
        }
      }
      #endif

      do {
        let notifCenter = UNUserNotificationCenter.current()
        let notifGranted = try await notifCenter.requestAuthorization(options: [.alert, .sound, .badge])
        if notifGranted {
          granted = true
        }
      } catch {
        print("StudICIAlarms: Notification authorization error: \(error)")
      }

      return granted
    }

    AsyncFunction("cancelAllAlarms") { () -> [String: Any] in
      var cancelledCount = 0

      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        let savedIds = UserDefaults.standard.stringArray(forKey: self.storageKey) ?? []
        for idStr in savedIds {
          if let uuid = UUID(uuidString: idStr) {
            try? AlarmManager.shared.cancel(id: uuid)
            cancelledCount += 1
          }
        }
        if let allAlarms = try? AlarmManager.shared.alarms {
          for alarm in allAlarms {
            try? AlarmManager.shared.cancel(id: alarm.id)
            cancelledCount += 1
          }
        }
        UserDefaults.standard.removeObject(forKey: self.storageKey)
      }
      #endif

      let notifCenter = UNUserNotificationCenter.current()
      let ids = (1...7).map { "studici_alarm_weekday_\($0)" }
      notifCenter.removePendingNotificationRequests(withIdentifiers: ids)
      notifCenter.removeDeliveredNotifications(withIdentifiers: ids)

      return ["success": true, "cancelledCount": cancelledCount]
    }

    AsyncFunction("scheduleWeeklyAlarm") {
      (weekday: Int, hour: Int, minute: Int, title: String, subtitle: String, tintColorHex: String) -> [String: Any] in

      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        do {
          let id = UUID()
          let dismissIntent = StudICIAlarmStopIntent(alarmIdentifier: id.uuidString)
          let tintColor = self.colorFromHex(tintColorHex)
          let timeStr = String(format: "%02d:%02d", hour, minute)

          let metadata = StudICIAlarmMetadata(
            title: title,
            subtitle: subtitle,
            alarmTime: timeStr
          )

          let attributes = AlarmAttributes(
            presentation: AlarmPresentation(
              alert: AlarmPresentation.Alert(
                title: LocalizedStringResource(stringLiteral: title),
                stopButton: AlarmButton(
                  text: LocalizedStringResource(stringLiteral: "Ferma"),
                  textColor: .white,
                  systemImageName: "stop.circle.fill"
                )
              )
            ),
            metadata: metadata,
            tintColor: tintColor
          )

          let localeWeekdays = self.weekdayFromInt(weekday)
          let cadence: Alarm.Schedule.Relative.Recurrence =
            localeWeekdays.isEmpty ? .never : .weekly(localeWeekdays)

          let schedule = Alarm.Schedule.relative(
            .init(
              time: .init(hour: hour, minute: minute),
              repeats: cadence
            )
          )

          let configuration = AlarmManager.AlarmConfiguration(
            schedule: schedule,
            attributes: attributes,
            stopIntent: dismissIntent,
            secondaryIntent: dismissIntent,
            sound: .default
          )

          let alarm = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
          var saved = UserDefaults.standard.stringArray(forKey: self.storageKey) ?? []
          saved.append(alarm.id.uuidString)
          UserDefaults.standard.set(saved, forKey: self.storageKey)

          return [
            "id": alarm.id.uuidString,
            "engine": "alarmkit"
          ]
        } catch {
          print("StudICIAlarms: AlarmKit schedule failed, falling back to UNUserNotificationCenter: \(error)")
        }
      }
      #endif

      // Fallback nativo su UNUserNotificationCenter con trigger ricorrente settimanale
      let notifId = "studici_alarm_weekday_\(weekday)"
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = subtitle
      content.sound = .default
      if #available(iOS 15.0, *) {
        content.interruptionLevel = .timeSensitive
      }

      var dateComponents = DateComponents()
      dateComponents.weekday = weekday
      dateComponents.hour = hour
      dateComponents.minute = minute
      dateComponents.second = 0

      let trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: true)
      let request = UNNotificationRequest(identifier: notifId, content: content, trigger: trigger)
      try await UNUserNotificationCenter.current().add(request)

      return [
        "id": notifId,
        "engine": "usernotifications"
      ]
    }
  }

  #if canImport(AlarmKit)
  @available(iOS 26.0, *)
  private func weekdayFromInt(_ day: Int) -> [Locale.Weekday] {
    switch day {
    case 1: return [.sunday]
    case 2: return [.monday]
    case 3: return [.tuesday]
    case 4: return [.wednesday]
    case 5: return [.thursday]
    case 6: return [.friday]
    case 7: return [.saturday]
    default: return []
    }
  }

  @available(iOS 26.0, *)
  private func colorFromHex(_ hex: String) -> Color {
    var hexSanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    hexSanitized = hexSanitized.replacingOccurrences(of: "#", with: "")
    var rgb: UInt64 = 0
    Scanner(string: hexSanitized).scanHexInt64(&rgb)
    let red = Double((rgb & 0xFF0000) >> 16) / 255.0
    let green = Double((rgb & 0x00FF00) >> 8) / 255.0
    let blue = Double(rgb & 0x0000FF) / 255.0
    return Color(red: red, green: green, blue: blue)
  }
  #endif
}
