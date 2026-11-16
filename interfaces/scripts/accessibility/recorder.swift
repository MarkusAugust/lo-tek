// What macOS's accessibility API (AX) gives a screen reader from Safari,
// recorded the way VoiceOver reads it: the focused node with its ancestors,
// and the notifications Safari posts. The counterpart of recorder.py.
//
//   recorder <notification>...
//
// The notifications to observe come from AX_EVENTS in platform.ts, on the
// command line. Writes one JSON line per message to stdout:
//   {"kind":"ready", "safari": version, "macos": version, "registered": [...]}
//   {"kind":"event", "type", "page", "node", "text"?, "priority"?, "live"?}
//   {"kind":"focused", "tag", "page", "node", "ancestors", "frontmost"}
//   {"kind":"interrupted", "reason"}   Safari stopped the automation
//   {"kind":"error", "message"}        and exits
// Reads commands from stdin, one per line: "focused <tag>", "quit".
import Accessibility
import ApplicationServices
import Cocoa

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ object: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  print(String(data: data, encoding: .utf8)!)
}

func fail(_ message: String) -> Never {
  emit(["kind": "error", "message": message])
  exit(1)
}

guard AXIsProcessTrusted() else {
  fail(
    "not-trusted: this terminal may not read other apps' accessibility. Allow it in System Settings, Privacy & Security, Accessibility, and run again"
  )
}
if NSWorkspace.shared.isVoiceOverEnabled {
  fail(
    "voiceover-runs: VoiceOver makes Safari stop the automation (\"Turn Off All Automation\"). Turn it off with Cmd-F5, and run again"
  )
}
guard
  let safari = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Safari")
    .first
else { fail("no-safari: Safari is not running") }

let app = AXUIElementCreateApplication(safari.processIdentifier)
let started = Date()

func value(_ element: AXUIElement, _ name: String) -> AnyObject? {
  var result: AnyObject?
  return AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success
    ? result : nil
}

func string(_ element: AXUIElement, _ name: String) -> String? {
  value(element, name) as? String
}

func element(_ object: AnyObject?) -> AXUIElement? {
  guard let object, CFGetTypeID(object) == AXUIElementGetTypeID() else { return nil }
  return (object as! AXUIElement)
}

/// The description, which Core-AAM puts in AXCustomContent with the label
/// "description". `nil` when there is none; "unreadable" is its own answer.
func description(_ e: AXUIElement) -> Any {
  guard let raw = value(e, "AXCustomContent") else { return "" }
  guard let data = raw as? Data else { return ["unreadable": "AXCustomContent is not data"] }
  // Without secure coding: the value is an attributed string, whose
  // attributes nest deeper than the secure decoder allows.
  do {
    let unarchiver = try NSKeyedUnarchiver(forReadingFrom: data)
    unarchiver.requiresSecureCoding = false
    let root = unarchiver.decodeObject(forKey: NSKeyedArchiveRootObjectKey)
    let contents = (root as? [AXCustomContent]) ?? (root as? AXCustomContent).map { [$0] } ?? []
    return contents.first { $0.label == "description" }?.value ?? ""
  } catch {
    return ["unreadable": "\(error)"]
  }
}

/// The role as one string: "AXGroup/AXApplicationDialog", or "AXButton".
func role(_ e: AXUIElement) -> String {
  let r = string(e, "AXRole") ?? ""
  guard let s = string(e, "AXSubrole"), !s.isEmpty else { return r }
  return "\(r)/\(s)"
}

/// The web area the element is in, or the element itself.
func webArea(_ e: AXUIElement) -> AXUIElement? {
  var current: AXUIElement? = e
  while let c = current {
    if string(c, "AXRole") == "AXWebArea" { return c }
    current = element(value(c, "AXParent"))
  }
  return nil
}

/// Whether everything outside the dialog is gone from the web area, which is
/// how Core-AAM maps aria-modal="true" on AX: "Prune the accessibility tree
/// such that the background content is no longer exposed."
func prunesBackground(_ dialog: AXUIElement) -> Bool {
  guard let area = webArea(dialog) else { return false }
  var chain: [AXUIElement] = []
  var current: AXUIElement? = dialog
  while let c = current, !CFEqual(c, area) {
    chain.append(c)
    current = element(value(c, "AXParent"))
  }
  // Every element from the dialog up to the web area must be the only child
  // of its parent that is exposed.
  for e in chain {
    guard let parent = element(value(e, "AXParent")),
      let children = value(parent, "AXChildren") as? [AXUIElement]
    else { return false }
    if children.count != 1 || !CFEqual(children[0], e) { return false }
  }
  return true
}

/// The states as the tokens `AX_STATES` in platform.ts names.
func states(_ e: AXUIElement) -> [String] {
  var result: [String] = []
  let r = string(e, "AXRole") ?? ""
  let sub = string(e, "AXSubrole") ?? ""
  if (value(e, "AXFocused") as? Bool) == true { result.append("AXFocused") }
  if (value(e, "AXExpanded") as? Bool) == true { result.append("AXExpanded") }
  if (value(e, "AXSelected") as? Bool) == true { result.append("AXSelected") }
  if (value(e, "AXRequired") as? Bool) == true { result.append("AXRequired") }
  if (value(e, "AXElementBusy") as? Bool) == true { result.append("AXElementBusy") }
  if let invalid = value(e, "AXInvalid") as? String, invalid != "false", !invalid.isEmpty {
    result.append("AXInvalid")
  }
  // aria-checked and aria-pressed are both AXValue: the role says which.
  // A tab is an AXRadioButton too, and its selection is not a check. Safari
  // gives a tab no AXTabButton subrole, so its parent, the AXTabGroup, says.
  let inTabs = element(value(e, "AXParent")).map { string($0, "AXRole") == "AXTabGroup" } ?? false
  let tab = sub == "AXTabButton" || (r == "AXRadioButton" && inTabs)
  if let v = value(e, "AXValue") as? NSNumber {
    if sub == "AXToggle" {
      if v.intValue == 1 { result.append("AXValue=1 (AXToggle)") }
    } else if r == "AXCheckBox" || (r == "AXRadioButton" && !tab) {
      if v.intValue == 1 { result.append("AXValue=1") }
      if v.intValue == 2 { result.append("AXValue=2") }
    }
  }
  // aria-readonly is whether AXValue can be set, on the roles that take it.
  if ["AXTextField", "AXTextArea", "AXComboBox"].contains(r) {
    var settable = DarwinBoolean(false)
    if AXUIElementIsAttributeSettable(e, "AXValue" as CFString, &settable) == .success,
      !settable.boolValue
    {
      result.append("AXValue not settable")
    }
  }
  if sub == "AXApplicationDialog" || sub == "AXApplicationAlertDialog",
    prunesBackground(e)
  {
    result.append("background pruned")
  }
  return result
}

/// The accessible name: AXTitle, where Core-AAM puts aria-label and
/// aria-labelledby. Two exceptions give it as AXDescription: a <fieldset>,
/// whose legend HTML-AAM maps to AXDescription, and the web area, the
/// document, whose name is its title (undocumented, seen in Safari 27.2).
func name(_ e: AXUIElement) -> String {
  let title = string(e, "AXTitle") ?? ""
  if title.isEmpty,
    string(e, "AXRole") == "AXWebArea" || string(e, "AXSubrole") == "AXFieldset"
  {
    return string(e, "AXDescription") ?? ""
  }
  return title
}

func node(_ e: AXUIElement) -> [String: Any] {
  var n: [String: Any] = [
    "role": role(e),
    "name": name(e),
    "states": states(e),
    "id": string(e, "AXDOMIdentifier") ?? "",
  ]
  let d = description(e)
  if let d = d as? String { n["description"] = d } else { n["description"] = ""; n["unreadable"] = d }
  if let live = string(e, "AXARIALive"), !live.isEmpty { n["live"] = live }
  return n
}

func ancestors(_ e: AXUIElement) -> [[String: Any]] {
  var list: [[String: Any]] = []
  var current = e
  while let parent = element(value(current, "AXParent")) {
    current = parent
    list.append(node(current))
    if string(current, "AXRole") == "AXWebArea" { break }
  }
  return list
}

/// The title of the document the element is in: the fixture's is the contract's component.
func page(_ e: AXUIElement) -> String {
  guard let area = webArea(e) else { return "" }
  let description = string(area, "AXDescription") ?? ""
  return description.isEmpty ? string(area, "AXTitle") ?? "" : description
}

func frontmost() -> String {
  NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
}

/* The notifications */

var observer: AXObserver?
let callback: AXObserverCallbackWithInfo = { _, e, notification, info, _ in
  let type = notification as String
  let n = node(e)
  // Safari's own prompt when something else uses the window it automates.
  if (n["name"] as? String) == "Turn Off All Automation" {
    emit(["kind": "interrupted", "reason": "Safari showed \"Turn Off All Automation\""])
  }
  var event: [String: Any] = [
    "kind": "event", "type": type, "page": page(e), "node": n,
    "ms": Int(Date().timeIntervalSince(started) * 1000),
  ]
  if let info = info as? [String: Any] {
    if let text = info["AXAnnouncementKey"] {
      event["text"] = (text as? NSAttributedString)?.string ?? (text as? String) ?? "\(text)"
    }
    if let priority = info["AXPriorityKey"] as? NSNumber { event["priority"] = priority.intValue }
    if let live = info["AXAnnouncementIsLiveRegionKey"] as? Bool { event["live"] = live }
  }
  emit(event)
}
guard AXObserverCreateWithInfoCallback(safari.processIdentifier, callback, &observer) == .success,
  let observer
else { fail("no-observer: AXObserverCreate failed for Safari") }
var registered: [String] = []
for name in CommandLine.arguments.dropFirst() {
  if AXObserverAddNotification(observer, app, name as CFString, nil) == .success {
    registered.append(name)
  }
}
CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)

// Another app in front takes the keyboard from Safari: the run says so.
NSWorkspace.shared.notificationCenter.addObserver(
  forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
) { note in
  let other = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
  if let id = other?.bundleIdentifier, id != "com.apple.Safari" {
    emit(["kind": "interrupted", "reason": "\(id) came to the front, and Safari lost the keyboard"])
  }
}

let safariVersion =
  Bundle(url: safari.bundleURL!)?.object(forInfoDictionaryKey: "CFBundleShortVersionString")
  as? String ?? "unknown"
emit([
  "kind": "ready", "safari": safariVersion,
  "macos": ProcessInfo.processInfo.operatingSystemVersionString, "registered": registered,
])

func handle(_ line: String) {
  let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
  switch parts.first {
  case "focused":
    let tag = parts.count > 1 ? parts[1] : ""
    guard let e = element(value(app, "AXFocusedUIElement")) else {
      emit([
        "kind": "focused", "tag": tag, "page": "", "node": NSNull(), "ancestors": [],
        "frontmost": frontmost(),
      ])
      return
    }
    emit([
      "kind": "focused", "tag": tag, "page": page(e), "node": node(e), "ancestors": ancestors(e),
      "frontmost": frontmost(),
    ])
  case "quit": exit(0)
  default: emit(["kind": "error", "message": "unknown command: \(line)"])
  }
}

// The commands are read on the main queue, where the observer's callbacks
// run too, so the two never interleave.
var input = Data()
let commands = DispatchSource.makeReadSource(fileDescriptor: 0, queue: .main)
commands.setEventHandler {
  var buffer = [UInt8](repeating: 0, count: 4096)
  let count = read(0, &buffer, buffer.count)
  if count <= 0 { exit(0) }
  input.append(contentsOf: buffer[0..<count])
  while let newline = input.firstIndex(of: 0x0A) {
    let line = String(decoding: input[input.startIndex..<newline], as: UTF8.self)
    input.removeSubrange(input.startIndex...newline)
    handle(line)
  }
}
commands.resume()

CFRunLoopRun()
