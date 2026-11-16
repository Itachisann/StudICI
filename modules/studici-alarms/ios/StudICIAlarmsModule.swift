import ExpoModulesCore
import Foundation
import UserNotifications
import EventKit
import CoreLocation
import CoreGraphics
import MapKit
import Contacts

struct StructuredLocationEntry: Record {
  @Field var eventId: String = ""
  @Field var title: String = ""
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
}

struct StrikeReminderInput: Record {
  @Field var existingId: String?
  @Field var calendarId: String = ""
  @Field var title: String = ""
  @Field var notes: String?
  @Field var url: String?
  @Field var dueDateMs: Double = 0
  @Field var timeZoneId: String?
  @Field var priority: Int = 1
  @Field var alarmRelativeOffsetsMinutes: [Int]?
}

private final class MapSuggestionCompleter: NSObject, MKLocalSearchCompleterDelegate {
  private var completer: MKLocalSearchCompleter?
  private let lock = NSLock()
  private var finished = false
  private var completions: [MKLocalSearchCompletion] = []
  private let semaphore = DispatchSemaphore(value: 0)

  func suggestSync(
    query: String,
    near coordinate: CLLocationCoordinate2D?,
    timeout: TimeInterval = 2.0
  ) -> [MKLocalSearchCompletion] {
    DispatchQueue.main.async {
      self.lock.lock()
      let alreadyDone = self.finished
      self.lock.unlock()
      guard !alreadyDone else { return }

      let comp = MKLocalSearchCompleter()
      comp.resultTypes = [.address, .pointOfInterest]
      if let coord = coordinate {
        comp.region = MKCoordinateRegion(
          center: coord,
          latitudinalMeters: 3000,
          longitudinalMeters: 3000
        )
      }
      comp.delegate = self
      self.completer = comp
      comp.queryFragment = query
    }

    let waitResult = self.semaphore.wait(timeout: .now() + timeout)
    self.lock.lock()
    if !self.finished {
      self.finished = true
    }
    let results = self.completions
    self.lock.unlock()

    if waitResult == .timedOut {
      DispatchQueue.main.async {
        self.completer?.delegate = nil
        self.completer?.cancel()
        self.completer = nil
      }
    }
    return results
  }

  func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
    let results = completer.results
    guard !results.isEmpty else { return }
    self.finish(with: Array(results.prefix(5)), completer: completer)
  }

  func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
    self.finish(with: [], completer: completer)
  }

  private func finish(with results: [MKLocalSearchCompletion], completer: MKLocalSearchCompleter) {
    self.lock.lock()
    guard !self.finished else {
      self.lock.unlock()
      return
    }
    self.finished = true
    self.completions = results
    self.lock.unlock()

    completer.delegate = nil
    completer.cancel()
    self.completer = nil
    self.semaphore.signal()
  }
}

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

    AsyncFunction("attachStructuredLocations") { (entries: [StructuredLocationEntry]) -> Int in
      let status = EKEventStore.authorizationStatus(for: .event)
      let authorized: Bool
      if #available(iOS 17.0, *) {
        authorized = (status == .fullAccess || status == .writeOnly)
      } else {
        authorized = (status == .authorized)
      }
      guard authorized, !entries.isEmpty else {
        return 0
      }

      self.sharedEventStore.refreshSourcesIfNecessary()

      // Pre-risolve una sola volta per ogni posizione univoca per rispettare i rate limit Apple Maps / CLGeocoder
      var mapItemCache: [String: MKMapItem] = [:]
      for entry in entries {
        let trimmedTitle = entry.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasValidCoords = entry.latitude.isFinite
          && entry.longitude.isFinite
          && (entry.latitude != 0 || entry.longitude != 0)
          && abs(entry.latitude) <= 90
          && abs(entry.longitude) <= 180
        guard hasValidCoords || !trimmedTitle.isEmpty else { continue }

        let coordKey = hasValidCoords
          ? String(format: "%.4f,%.4f", entry.latitude, entry.longitude)
          : "none"
        let cacheKey = "\(trimmedTitle.lowercased())|\(coordKey)"
        if mapItemCache[cacheKey] != nil { continue }

        let targetCoord: CLLocationCoordinate2D? = hasValidCoords
          ? CLLocationCoordinate2D(latitude: entry.latitude, longitude: entry.longitude)
          : nil
        if let resolved = self.resolveMapItemSync(query: trimmedTitle, coordinate: targetCoord) {
          mapItemCache[cacheKey] = resolved
        }
      }

      var pendingEntries: [StructuredLocationEntry] = []
      var updated = 0

      func applyEntry(_ entry: StructuredLocationEntry) -> Bool {
        guard !entry.eventId.isEmpty,
              let event = self.findEvent(in: self.sharedEventStore, identifier: entry.eventId) else {
          return false
        }
        guard event.calendar.allowsContentModifications else {
          return true
        }

        let trimmedTitle = entry.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasValidCoords = entry.latitude.isFinite
          && entry.longitude.isFinite
          && (entry.latitude != 0 || entry.longitude != 0)
          && abs(entry.latitude) <= 90
          && abs(entry.longitude) <= 180
        let coordKey = hasValidCoords
          ? String(format: "%.4f,%.4f", entry.latitude, entry.longitude)
          : "none"
        let cacheKey = "\(trimmedTitle.lowercased())|\(coordKey)"

        let locTitle = !trimmedTitle.isEmpty ? trimmedTitle : (event.location ?? "")
        let structured: EKStructuredLocation
        let finalLocationText: String

        if let mapItem = mapItemCache[cacheKey] {
          structured = EKStructuredLocation(mapItem: mapItem)
          if hasValidCoords && structured.geoLocation == nil {
            structured.geoLocation = CLLocation(latitude: entry.latitude, longitude: entry.longitude)
          }
          if structured.radius <= 0 {
            structured.radius = 100
          }
          if (structured.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "").isEmpty,
             !locTitle.isEmpty {
            structured.title = locTitle
          }
          let formatted = self.formatDisplayLocation(
            mapItem: mapItem,
            fallbackTitle: locTitle,
            existingLocation: event.location
          )
          finalLocationText = formatted.isEmpty ? locTitle : formatted
        } else if hasValidCoords {
          let coord = CLLocationCoordinate2D(latitude: entry.latitude, longitude: entry.longitude)
          let fallbackItem = self.fallbackPostalMapItem(title: locTitle, coordinate: coord)
          structured = EKStructuredLocation(mapItem: fallbackItem)
          if structured.geoLocation == nil {
            structured.geoLocation = CLLocation(latitude: entry.latitude, longitude: entry.longitude)
          }
          if structured.radius <= 0 {
            structured.radius = 100
          }
          if (structured.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "").isEmpty,
             !locTitle.isEmpty {
            structured.title = locTitle
          }
          finalLocationText = locTitle
        } else {
          return true
        }

        // Imposta prima event.location e poi structuredLocation affinche' EventKit mantenga la card mappa
        if !finalLocationText.isEmpty {
          event.location = finalLocationText
        }
        event.structuredLocation = structured

        let preferredSpan: EKSpan = event.hasRecurrenceRules ? .futureEvents : .thisEvent
        do {
          try self.sharedEventStore.save(event, span: preferredSpan, commit: true)
          updated += 1
        } catch {
          if preferredSpan == .futureEvents {
            do {
              try self.sharedEventStore.save(event, span: .thisEvent, commit: true)
              updated += 1
            } catch {
              print("StudICIAlarms: attachStructuredLocation save error for \(entry.eventId): \(error)")
            }
          } else {
            print("StudICIAlarms: attachStructuredLocation save error for \(entry.eventId): \(error)")
          }
        }
        return true
      }

      for entry in entries {
        if !applyEntry(entry) {
          pendingEntries.append(entry)
        }
      }

      if !pendingEntries.isEmpty {
        Thread.sleep(forTimeInterval: 0.2)
        self.sharedEventStore.refreshSourcesIfNecessary()
        var stillPending: [StructuredLocationEntry] = []
        for entry in pendingEntries {
          if !applyEntry(entry) {
            stillPending.append(entry)
          }
        }
        if !stillPending.isEmpty {
          Thread.sleep(forTimeInterval: 0.35)
          self.sharedEventStore.refreshSourcesIfNecessary()
          for entry in stillPending {
            _ = applyEntry(entry)
          }
        }
      }

      return updated
    }

    AsyncFunction("getFreshEventCalendars") { () -> [[String: Any]] in
      let status = EKEventStore.authorizationStatus(for: .event)
      let authorized: Bool
      if #available(iOS 17.0, *) {
        authorized = (status == .fullAccess)
      } else {
        authorized = (status == .authorized)
      }
      guard authorized else {
        return []
      }

      let eventStore = EKEventStore()
      eventStore.refreshSourcesIfNecessary()
      let calendars = eventStore.calendars(for: .event)

      return calendars.map { cal in
        let calSource: EKSource? = cal.source
        let calTitle: String? = cal.title
        var dict: [String: Any] = [
          "id": cal.calendarIdentifier,
          "title": calTitle ?? "",
          "allowsModifications": cal.allowsContentModifications,
          "source": [
            "id": calSource?.sourceIdentifier ?? "",
            "name": calSource?.title ?? "",
            "type": self.sourceTypeString(calSource?.sourceType)
          ]
        ]
        if let hex = self.hexStringFromCGColor(cal.cgColor) {
          dict["color"] = hex
        }
        return dict
      }
    }

    AsyncFunction("updateEventCalendarMetadata") { (calendarId: String, title: String?, colorHex: String?) -> Bool in
      let status = EKEventStore.authorizationStatus(for: .event)
      let authorized: Bool
      if #available(iOS 17.0, *) {
        authorized = (status == .fullAccess || status == .writeOnly)
      } else {
        authorized = (status == .authorized)
      }
      guard authorized,
            !calendarId.isEmpty else {
        return false
      }

      let eventStore = EKEventStore()
      eventStore.refreshSourcesIfNecessary()
      guard let cal = eventStore.calendar(withIdentifier: calendarId),
            cal.allowsContentModifications else {
        return false
      }

      var dirty = false
      if let rawTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines),
         !rawTitle.isEmpty,
         cal.title != rawTitle {
        cal.title = rawTitle
        dirty = true
      }

      if let hex = colorHex,
         let newCGColor = self.cgColorFromHex(hex) {
        let currentHex = self.hexStringFromCGColor(cal.cgColor)?.lowercased()
        let nextHex = self.hexStringFromCGColor(newCGColor)?.lowercased()
        if currentHex != nextHex {
          cal.cgColor = newCGColor
          dirty = true
        }
      }

      guard dirty else {
        return true
      }

      do {
        try eventStore.saveCalendar(cal, commit: true)
        return true
      } catch {
        print("StudICIAlarms: updateEventCalendarMetadata save error for \(calendarId): \(error)")
        return false
      }
    }

    AsyncFunction("getStrikeReminders") { () -> [[String: Any]] in
      guard self.isRemindersAuthorized(requireFull: true) else {
        return []
      }
      let eventStore = EKEventStore()
      eventStore.refreshSourcesIfNecessary()
      let predicate = eventStore.predicateForReminders(in: nil)
      let sem = DispatchSemaphore(value: 0)
      var fetched: [EKReminder] = []
      eventStore.fetchReminders(matching: predicate) { reminders in
        if let reminders = reminders {
          fetched = reminders
        }
        sem.signal()
      }
      _ = sem.wait(timeout: .now() + 5.0)

      let gregorian = Calendar(identifier: .gregorian)
      return fetched.map { rem in
        var dueMs: Double = 0
        if let comps = rem.dueDateComponents {
          let cal = comps.calendar ?? gregorian
          if let dt = cal.date(from: comps) {
            dueMs = dt.timeIntervalSince1970 * 1000.0
          }
        }
        let offsets: [Int] = (rem.alarms ?? []).compactMap { alarm -> Int? in
          let relMins = Int((alarm.relativeOffset / 60.0).rounded())
          if relMins < 0 {
            return relMins
          }
          if let absDate = alarm.absoluteDate, dueMs > 0 {
            let diffMin = Int(((absDate.timeIntervalSince1970 - (dueMs / 1000.0)) / 60.0).rounded())
            if diffMin < -1 {
              return diffMin
            }
          }
          return nil
        }.sorted()

        return [
          "id": rem.calendarItemIdentifier,
          "calendarId": rem.calendar?.calendarIdentifier ?? "",
          "title": rem.title ?? "",
          "notes": rem.notes ?? "",
          "url": rem.url?.absoluteString ?? "",
          "completed": rem.isCompleted,
          "priority": rem.priority,
          "dueDateMs": dueMs,
          "alarmOffsetsMinutes": offsets,
        ]
      }
    }

    AsyncFunction("upsertStrikeReminder") { (input: StrikeReminderInput) -> String? in
      guard self.isRemindersAuthorized(requireFull: false) else {
        return nil
      }
      let eventStore = EKEventStore()
      eventStore.refreshSourcesIfNecessary()

      var targetCal: EKCalendar?
      if !input.calendarId.isEmpty,
         let byId = eventStore.calendar(withIdentifier: input.calendarId),
         byId.allowsContentModifications {
        targetCal = byId
      }
      if targetCal == nil {
        targetCal = eventStore.defaultCalendarForNewReminders()
      }
      guard let calendar = targetCal, calendar.allowsContentModifications else {
        return nil
      }

      let reminder: EKReminder
      if let existingId = input.existingId,
         !existingId.isEmpty,
         let existing = eventStore.calendarItem(withIdentifier: existingId) as? EKReminder {
        reminder = existing
      } else {
        reminder = EKReminder(eventStore: eventStore)
      }

      reminder.calendar = calendar
      reminder.title = input.title
      let trimmedNotes = input.notes?.trimmingCharacters(in: .whitespacesAndNewlines)
      reminder.notes = (trimmedNotes?.isEmpty == false) ? trimmedNotes : nil

      if let rawUrl = input.url?.trimmingCharacters(in: .whitespacesAndNewlines),
         !rawUrl.isEmpty,
         let parsedUrl = URL(string: rawUrl) {
        reminder.url = parsedUrl
      } else {
        reminder.url = nil
      }

      reminder.isCompleted = false
      reminder.priority = max(0, min(9, input.priority))

      let tz = input.timeZoneId.flatMap { TimeZone(identifier: $0) } ?? TimeZone.current
      var cal = Calendar(identifier: .gregorian)
      cal.timeZone = tz
      let dueDate = Date(timeIntervalSince1970: input.dueDateMs / 1000.0)
      var comps = cal.dateComponents(
        [.era, .year, .month, .day, .hour, .minute, .second],
        from: dueDate
      )
      comps.calendar = cal
      comps.timeZone = tz
      reminder.startDateComponents = comps
      reminder.dueDateComponents = comps
      reminder.timeZone = tz

      // Configura gli allarmi nativi: allarme principale alla scadenza (relativeOffset: 0)
      // più eventuali allarmi anticipati con relativeOffset negativo (es. -1 giorno / -7 giorni)
      var newAlarms: [EKAlarm] = [EKAlarm(relativeOffset: 0)]
      if let offsets = input.alarmRelativeOffsetsMinutes {
        for offsetMin in offsets where offsetMin < 0 {
          newAlarms.append(EKAlarm(relativeOffset: TimeInterval(offsetMin * 60)))
        }
      }
      reminder.alarms = newAlarms

      do {
        try eventStore.save(reminder, commit: true)
        return reminder.calendarItemIdentifier
      } catch {
        print("StudICIAlarms: upsertStrikeReminder save error: \(error)")
        return nil
      }
    }

    AsyncFunction("deleteStrikeReminder") { (reminderId: String) -> Bool in
      guard self.isRemindersAuthorized(requireFull: false),
            !reminderId.isEmpty else {
        return false
      }
      let eventStore = EKEventStore()
      guard let reminder = eventStore.calendarItem(withIdentifier: reminderId) as? EKReminder else {
        return true
      }
      do {
        try eventStore.remove(reminder, commit: true)
        return true
      } catch {
        print("StudICIAlarms: deleteStrikeReminder error for \(reminderId): \(error)")
        return false
      }
    }
  }

  private func isRemindersAuthorized(requireFull: Bool) -> Bool {
    let status = EKEventStore.authorizationStatus(for: .reminder)
    if #available(iOS 17.0, *) {
      if requireFull {
        return status == .fullAccess
      }
      return status == .fullAccess || status == .writeOnly
    } else {
      return status == .authorized
    }
  }

  private let sharedEventStore = EKEventStore()

  private func findEvent(in store: EKEventStore, identifier: String) -> EKEvent? {
    if let item = store.calendarItem(withIdentifier: identifier) as? EKEvent {
      return item
    }
    if let ev = store.event(withIdentifier: identifier) {
      return ev
    }
    return nil
  }

  private func resolveMapItemSync(query: String, coordinate: CLLocationCoordinate2D?) -> MKMapItem? {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    var queries: [String] = []
    if !trimmed.isEmpty {
      let parts = trimmed
        .split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
      if parts.count >= 3 {
        let poiName = parts[0]
        let addressOnly = parts.dropFirst().joined(separator: ", ")
        let lowerPoi = poiName.lowercased()
        let isNamedPlace = lowerPoi.contains("stazione")
          || lowerPoi.contains("sapienza")
          || lowerPoi.contains("universit")
          || lowerPoi.contains("facolt")
          || lowerPoi.contains("edificio")
          || lowerPoi.contains("polo")
          || lowerPoi.contains("palazzo")
        if isNamedPlace {
          queries = [poiName, trimmed, addressOnly]
        } else {
          queries = [trimmed, addressOnly, poiName]
        }
      } else {
        queries = [trimmed]
      }
      var deduplicated: [String] = []
      for q in queries where !q.isEmpty && !deduplicated.contains(q) {
        deduplicated.append(q)
      }
      queries = deduplicated
    }

    // 1. Suggerimenti ufficiali Apple Maps (MKLocalSearchCompleter + MKLocalSearch.Request(completion:))
    for candidate in queries {
      let suggestions = MapSuggestionCompleter().suggestSync(query: candidate, near: coordinate)
      for suggestion in suggestions.prefix(3) {
        let req = MKLocalSearch.Request(completion: suggestion)
        if let item = self.executeLocalSearchSync(request: req, near: coordinate) {
          return item
        }
      }
    }

    // 2. Fallback ricerca testuale diretta MKLocalSearch
    for candidate in queries {
      if let item = self.localSearchSync(query: candidate, near: coordinate) {
        return item
      }
    }

    // 3. Fallback CLGeocoder reverse/forward
    return self.geocoderMapItemSync(query: trimmed, coordinate: coordinate)
  }

  private func localSearchSync(query: String, near coordinate: CLLocationCoordinate2D?) -> MKMapItem? {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }

    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = trimmed
    if let coord = coordinate {
      request.region = MKCoordinateRegion(
        center: coord,
        latitudinalMeters: 3000,
        longitudinalMeters: 3000
      )
    }
    return self.executeLocalSearchSync(request: request, near: coordinate)
  }

  private func executeLocalSearchSync(
    request: MKLocalSearch.Request,
    near coordinate: CLLocationCoordinate2D?
  ) -> MKMapItem? {
    let semaphore = DispatchSemaphore(value: 0)
    let lock = NSLock()
    var finished = false
    var foundItem: MKMapItem?

    let search = MKLocalSearch(request: request)
    search.start { response, _ in
      lock.lock()
      defer {
        finished = true
        lock.unlock()
        semaphore.signal()
      }
      guard let items = response?.mapItems, !items.isEmpty else { return }

      if let targetCoord = coordinate {
        let targetLoc = CLLocation(latitude: targetCoord.latitude, longitude: targetCoord.longitude)
        let nearby = items.compactMap { item -> (item: MKMapItem, dist: CLLocationDistance, hasPostal: Bool)? in
          guard let itemLoc = item.placemark.location else { return nil }
          let dist = itemLoc.distance(from: targetLoc)
          guard dist <= 3500 else { return nil }
          return (item, dist, item.placemark.postalAddress != nil)
        }
        foundItem = nearby.sorted { a, b in
          if a.hasPostal != b.hasPostal { return a.hasPostal }
          return a.dist < b.dist
        }.first?.item
      } else {
        foundItem = items.first { $0.placemark.postalAddress != nil } ?? items.first
      }
    }

    let waitResult = semaphore.wait(timeout: .now() + 2.5)
    lock.lock()
    let alreadyDone = finished
    let resolved = foundItem
    lock.unlock()

    if waitResult == .timedOut && !alreadyDone {
      search.cancel()
    }
    return resolved
  }

  private func geocoderMapItemSync(query: String, coordinate: CLLocationCoordinate2D?) -> MKMapItem? {
    guard coordinate != nil || !query.isEmpty else { return nil }

    let semaphore = DispatchSemaphore(value: 0)
    let lock = NSLock()
    var finished = false
    var resolvedItem: MKMapItem?
    let geocoder = CLGeocoder()

    let handlePlacemarks: ([CLPlacemark]?, Error?) -> Void = { placemarks, _ in
      lock.lock()
      defer {
        finished = true
        lock.unlock()
        semaphore.signal()
      }
      guard let placemark = placemarks?.first else { return }
      let targetCoord = coordinate ?? placemark.location?.coordinate
      guard let finalCoord = targetCoord else { return }

      let postal = placemark.postalAddress ?? self.buildPostalAddress(from: placemark, fallbackQuery: query)
      let mkPlacemark = MKPlacemark(coordinate: finalCoord, postalAddress: postal)
      let mapItem = MKMapItem(placemark: mkPlacemark)
      if !query.isEmpty {
        let firstPart = query.split(separator: ",").first.map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) } ?? query
        mapItem.name = firstPart.isEmpty ? placemark.name : firstPart
      } else {
        mapItem.name = placemark.name
      }
      resolvedItem = mapItem
    }

    if let coord = coordinate {
      geocoder.reverseGeocodeLocation(
        CLLocation(latitude: coord.latitude, longitude: coord.longitude),
        completionHandler: handlePlacemarks
      )
    } else {
      geocoder.geocodeAddressString(query, completionHandler: handlePlacemarks)
    }

    let waitResult = semaphore.wait(timeout: .now() + 2.5)
    lock.lock()
    let alreadyDone = finished
    let item = resolvedItem
    lock.unlock()

    if waitResult == .timedOut && !alreadyDone {
      geocoder.cancelGeocode()
    }
    return item
  }

  private func buildPostalAddress(from placemark: CLPlacemark, fallbackQuery: String) -> CNPostalAddress {
    let mutable = CNMutablePostalAddress()
    let streetParts = [placemark.thoroughfare, placemark.subThoroughfare]
      .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
    let parsedFallback = self.parseItalianPostalAddress(from: fallbackQuery)

    mutable.street = streetParts.isEmpty ? parsedFallback.street : streetParts.joined(separator: " ")
    mutable.postalCode = placemark.postalCode ?? parsedFallback.postalCode
    mutable.city = placemark.locality ?? placemark.subAdministrativeArea ?? parsedFallback.city
    mutable.state = placemark.administrativeArea ?? ""
    mutable.country = placemark.country ?? "Italia"
    mutable.isoCountryCode = placemark.isoCountryCode ?? "IT"
    return mutable
  }

  private func fallbackPostalMapItem(title: String, coordinate: CLLocationCoordinate2D) -> MKMapItem {
    let postal = self.parseItalianPostalAddress(from: title)
    let placemark = MKPlacemark(coordinate: coordinate, postalAddress: postal)
    let mapItem = MKMapItem(placemark: placemark)
    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty {
      let firstPart = trimmed.split(separator: ",").first.map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) } ?? trimmed
      mapItem.name = firstPart.isEmpty ? trimmed : firstPart
    }
    return mapItem
  }

  private func parseItalianPostalAddress(from raw: String) -> CNPostalAddress {
    let mutable = CNMutablePostalAddress()
    mutable.country = "Italia"
    mutable.isoCountryCode = "IT"

    let clean = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty else { return mutable }

    let parts = clean
      .split(separator: ",")
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }

    var capValue = ""
    var cityValue = ""
    var capPartIndex: Int?

    if let regex = try? NSRegularExpression(pattern: "\\b(\\d{5})\\b", options: []) {
      for (idx, part) in parts.enumerated() {
        let nsRange = NSRange(part.startIndex..<part.endIndex, in: part)
        if let match = regex.firstMatch(in: part, options: [], range: nsRange),
           let capRange = Range(match.range(at: 1), in: part) {
          capValue = String(part[capRange])
          capPartIndex = idx
          let afterCap = String(part[capRange.upperBound...])
            .trimmingCharacters(in: .whitespacesAndNewlines)
          if !afterCap.isEmpty {
            cityValue = afterCap
          }
          break
        }
      }
    }

    if let capIdx = capPartIndex {
      mutable.postalCode = capValue
      if !cityValue.isEmpty {
        mutable.city = cityValue
      } else if capIdx + 1 < parts.count {
        mutable.city = parts[capIdx + 1]
      }
      if capIdx > 0 {
        mutable.street = parts[capIdx - 1]
      }
    } else if parts.count >= 2 {
      mutable.street = parts[0]
      let lastPart = parts[parts.count - 1]
      if lastPart.lowercased() != "italia" {
        mutable.city = lastPart
      } else if parts.count >= 3 {
        mutable.city = parts[parts.count - 2]
      }
    } else {
      mutable.street = clean
    }

    return mutable
  }

  private func formatDisplayLocation(
    mapItem: MKMapItem,
    fallbackTitle: String,
    existingLocation: String?
  ) -> String {
    if let postal = mapItem.placemark.postalAddress {
      let formatted = CNPostalAddressFormatter
        .string(from: postal, style: .mailingAddress)
        .trimmingCharacters(in: .whitespacesAndNewlines)
      let itemName = mapItem.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      if !itemName.isEmpty,
         !formatted.isEmpty,
         !formatted.localizedCaseInsensitiveContains(itemName) {
        return "\(itemName)\n\(formatted)"
      }
      if !formatted.isEmpty {
        return formatted
      }
    }
    if let itemName = mapItem.name?.trimmingCharacters(in: .whitespacesAndNewlines), !itemName.isEmpty {
      return itemName
    }
    if !fallbackTitle.isEmpty {
      return fallbackTitle
    }
    return existingLocation ?? ""
  }

  private func sourceTypeString(_ sourceType: EKSourceType?) -> String {
    guard let sourceType = sourceType else { return "local" }
    switch sourceType {
    case .local: return "local"
    case .exchange: return "exchange"
    case .calDAV: return "caldav"
    case .mobileMe: return "mobileme"
    case .subscribed: return "subscribed"
    case .birthdays: return "birthdays"
    @unknown default: return "local"
    }
  }

  private func hexStringFromCGColor(_ cgColor: CGColor?) -> String? {
    guard let color = cgColor else { return nil }
    let srgbColor: CGColor
    if let srgbSpace = CGColorSpace(name: CGColorSpace.sRGB),
       let converted = color.converted(to: srgbSpace, intent: .defaultIntent, options: nil) {
      srgbColor = converted
    } else {
      srgbColor = color
    }
    guard let components = srgbColor.components else { return nil }
    let r: CGFloat
    let g: CGFloat
    let b: CGFloat
    if components.count >= 3 {
      r = components[0]
      g = components[1]
      b = components[2]
    } else if components.count >= 1 {
      r = components[0]
      g = components[0]
      b = components[0]
    } else {
      return nil
    }
    let clampByte = { (v: CGFloat) -> Int in
      let clamped = min(max(Double(v), 0.0), 1.0)
      return Int((clamped * 255.0).rounded())
    }
    return String(format: "#%02x%02x%02x", clampByte(r), clampByte(g), clampByte(b))
  }

  private func cgColorFromHex(_ hex: String) -> CGColor? {
    var clean = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if clean.hasPrefix("#") {
      clean.removeFirst()
    }
    guard clean.count == 6 || clean.count == 8,
          let val = UInt64(clean, radix: 16) else {
      return nil
    }
    let r: CGFloat
    let g: CGFloat
    let b: CGFloat
    let a: CGFloat
    if clean.count == 6 {
      r = CGFloat((val & 0xFF0000) >> 16) / 255.0
      g = CGFloat((val & 0x00FF00) >> 8) / 255.0
      b = CGFloat(val & 0x0000FF) / 255.0
      a = 1.0
    } else {
      r = CGFloat((val & 0xFF000000) >> 24) / 255.0
      g = CGFloat((val & 0x00FF0000) >> 16) / 255.0
      b = CGFloat((val & 0x0000FF00) >> 8) / 255.0
      a = CGFloat(val & 0x000000FF) / 255.0
    }
    return CGColor(srgbRed: r, green: g, blue: b, alpha: a)
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
