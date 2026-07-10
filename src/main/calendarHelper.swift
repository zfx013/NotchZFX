// Helper calendrier (macOS), executable en ligne de commande — PAS d'UI/fenetre.
//
// Demande l'acces complet aux evenements ET aux rappels via EventKit (macOS 14+/26),
// attend la reponse, puis imprime sur stdout UN SEUL objet JSON et quitte :
//   { "authorized": bool, "remindersAuthorized": bool,
//     "calendars":[{id,title,color,type:"event"}],
//     "reminderLists":[{id,title,color,type:"reminder"}],
//     "events":[{id,title,start,end,allDay,calendarId,calendar,color}],
//     "reminders":[{id,title,due,completed,listId,list}] }
//
// Argument optionnel : nombre de jours a couvrir (defaut 7).
// Robuste : acces refuse -> authorized:false + listes vides, sortie 0.
//
// IMPORTANT : ce binaire DOIT etre compile + signe ad-hoc dans un bundle .app
// (voir build-calendar.sh) pour que la permission TCC calendrier/rappels soit
// correctement attribuee. `swift calendarHelper.swift` ne suffit pas.
import AppKit // pour la conversion couleur NSColor
import EventKit
import Foundation

// Nombre de jours a couvrir (defaut 7), depuis le 1er argument s'il est fourni.
let days: Int = {
    if CommandLine.arguments.count > 1, let d = Int(CommandLine.arguments[1]), d > 0 {
        return d
    }
    return 7
}()

let store = EKEventStore()

// --- Conversion couleur -> hex #RRGGBB -------------------------------------
func hexColor(_ cg: CGColor?) -> String {
    guard let cg = cg else { return "#808080" }
    // Passe par NSColor pour normaliser vers l'espace RGB.
    guard let ns = NSColor(cgColor: cg)?.usingColorSpace(.sRGB) else { return "#808080" }
    let r = Int((ns.redComponent * 255).rounded())
    let g = Int((ns.greenComponent * 255).rounded())
    let b = Int((ns.blueComponent * 255).rounded())
    return String(format: "#%02X%02X%02X", max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))
}

// --- Formatteur ISO8601 -----------------------------------------------------
let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()

func isoString(_ date: Date?) -> String? {
    guard let date = date else { return nil }
    return iso.string(from: date)
}

// --- Demande d'acces (evenements + rappels) --------------------------------
// requestFullAccessToEvents / requestFullAccessToReminders : macOS 14+/26.
var eventsAuthorized = false
var remindersAuthorized = false

let group = DispatchGroup()

group.enter()
store.requestFullAccessToEvents { granted, _ in
    eventsAuthorized = granted
    group.leave()
}

group.enter()
store.requestFullAccessToReminders { granted, _ in
    remindersAuthorized = granted
    group.leave()
}

// Attend les deux reponses (avec garde-fou de temps).
_ = group.wait(timeout: .now() + 6)

// --- Sortie robuste ---------------------------------------------------------
func emitJSON(_ obj: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    } else {
        print("{\"authorized\":false,\"remindersAuthorized\":false,\"calendars\":[],\"reminderLists\":[],\"events\":[],\"reminders\":[]}")
    }
    fflush(stdout)
}

// Si tout est refuse, on sort proprement avec des listes vides.
if !eventsAuthorized && !remindersAuthorized {
    emitJSON([
        "authorized": false,
        "remindersAuthorized": false,
        "calendars": [],
        "reminderLists": [],
        "events": [],
        "reminders": [],
    ])
    exit(0)
}

// --- Calendriers d'evenements ----------------------------------------------
var calendarsOut: [[String: Any]] = []
var eventsOut: [[String: Any]] = []

if eventsAuthorized {
    let cals = store.calendars(for: .event)
    for cal in cals {
        calendarsOut.append([
            "id": cal.calendarIdentifier,
            "title": cal.title,
            "color": hexColor(cal.cgColor),
            "type": "event",
        ])
    }

    // Evenements d'aujourd'hui (debut de journee) jusqu'a +N jours.
    let calGregorian = Calendar.current
    let start = calGregorian.startOfDay(for: Date())
    let end = calGregorian.date(byAdding: .day, value: days, to: start) ?? start.addingTimeInterval(Double(days) * 86400)
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: cals.isEmpty ? nil : cals)
    let events = store.events(matching: predicate)

    for ev in events {
        var e: [String: Any] = [
            "id": ev.eventIdentifier ?? UUID().uuidString,
            "title": ev.title ?? "",
            "allDay": ev.isAllDay,
            "calendarId": ev.calendar?.calendarIdentifier ?? "",
            "calendar": ev.calendar?.title ?? "",
            "color": hexColor(ev.calendar?.cgColor),
        ]
        e["start"] = isoString(ev.startDate) ?? NSNull()
        e["end"] = isoString(ev.endDate) ?? NSNull()
        eventsOut.append(e)
    }
    // Tri chronologique par date de debut.
    eventsOut.sort { (a, b) -> Bool in
        let sa = (a["start"] as? String) ?? ""
        let sb = (b["start"] as? String) ?? ""
        return sa < sb
    }
}

// --- Listes de rappels + rappels a venir non termines ----------------------
var reminderListsOut: [[String: Any]] = []
var remindersOut: [[String: Any]] = []

if remindersAuthorized {
    let lists = store.calendars(for: .reminder)
    for list in lists {
        reminderListsOut.append([
            "id": list.calendarIdentifier,
            "title": list.title,
            "color": hexColor(list.cgColor),
            "type": "reminder",
        ])
    }

    // Rappels non termines (a venir) — recuperation asynchrone via semaphore.
    let sem = DispatchSemaphore(value: 0)
    let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: lists.isEmpty ? nil : lists)
    store.fetchReminders(matching: predicate) { fetched in
        for r in fetched ?? [] {
            if r.isCompleted { continue }
            var dueDate: Date? = nil
            if let comp = r.dueDateComponents {
                dueDate = Calendar.current.date(from: comp)
            }
            remindersOut.append([
                "id": r.calendarItemIdentifier,
                "title": r.title ?? "",
                "due": isoString(dueDate) ?? NSNull(),
                "completed": r.isCompleted,
                "listId": r.calendar?.calendarIdentifier ?? "",
                "list": r.calendar?.title ?? "",
            ])
        }
        sem.signal()
    }
    _ = sem.wait(timeout: .now() + 5)

    // Tri : rappels avec date d'abord (chronologique), puis sans date.
    remindersOut.sort { (a, b) -> Bool in
        let da = a["due"] as? String
        let db = b["due"] as? String
        switch (da, db) {
        case let (.some(x), .some(y)): return x < y
        case (.some, .none): return true
        case (.none, .some): return false
        default: return false
        }
    }
}

// --- Sortie finale ----------------------------------------------------------
emitJSON([
    "authorized": eventsAuthorized,
    "remindersAuthorized": remindersAuthorized,
    "calendars": calendarsOut,
    "reminderLists": reminderListsOut,
    "events": eventsOut,
    "reminders": remindersOut,
])
exit(0)
