// Sound devices of the Mac as MPD's "osx" output sees them (Core Audio, kAudioObjectPropertyName): its "device" setting
// must match this name exactly. Prints JSON {"devices": [{"name", "transport", "outputs", "uid", "default"}]}; only devices
// that can play ("default": the Mac's sound output now).
//   audiodevices set <uid>: makes that device the Mac's sound output (Bluetooth: MPD cannot open it directly, error -10851,
//   so Xplorio plays on "Systemausgabe" and switches the Mac's output instead). Prints {"ok": true|false}.
// Built by make-app.sh into Resources/xplorio/mac/audiodevices; the tag service asks it on "Find devices" (macaudio.js).
import CoreAudio
import Foundation

func address(_ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    return AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: 0)
}
func name(_ id: AudioObjectID) -> String {
    var a = address(kAudioObjectPropertyName)
    var s: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(id, &a, 0, nil, &size, &s) == noErr, let v = s else { return "" }
    return v.takeRetainedValue() as String
}
func uid(_ id: AudioObjectID) -> String {
    var a = address(kAudioDevicePropertyDeviceUID)
    var s: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(id, &a, 0, nil, &size, &s) == noErr, let v = s else { return "" }
    return v.takeRetainedValue() as String
}
func defaultOutput() -> AudioObjectID {
    var a = address(kAudioHardwarePropertyDefaultOutputDevice)
    var id = AudioObjectID(0)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    _ = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size, &id)
    return id
}
func outputChannels(_ id: AudioObjectID) -> Int {
    var a = address(kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyScopeOutput)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &a, 0, nil, &size) == noErr, size > 0 else { return 0 }
    let buf = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { buf.deallocate() }
    guard AudioObjectGetPropertyData(id, &a, 0, nil, &size, buf) == noErr else { return 0 }
    let list = UnsafeMutableAudioBufferListPointer(buf.assumingMemoryBound(to: AudioBufferList.self))
    return list.reduce(0) { $0 + Int($1.mNumberChannels) }
}
func transport(_ id: AudioObjectID) -> String {
    var a = address(kAudioDevicePropertyTransportType)
    var t: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(id, &a, 0, nil, &size, &t) == noErr else { return "other" }
    switch t {
    case kAudioDeviceTransportTypeUSB: return "usb"
    case kAudioDeviceTransportTypeBuiltIn: return "builtin"
    case kAudioDeviceTransportTypeAirPlay: return "airplay"
    case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: return "bluetooth"
    case kAudioDeviceTransportTypeHDMI, kAudioDeviceTransportTypeDisplayPort: return "hdmi"
    case kAudioDeviceTransportTypeVirtual, kAudioDeviceTransportTypeAggregate: return "virtual"
    default: return "other"
    }
}

func allDevices() -> [AudioObjectID] {
    var a = address(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size) == noErr else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}
func printJSON(_ o: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: o, options: [])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

let args = CommandLine.arguments
if args.count >= 3 && args[1] == "set" {
    var ok = false
    if let id = allDevices().first(where: { uid($0) == args[2] && outputChannels($0) > 0 }) {
        var a = address(kAudioHardwarePropertyDefaultOutputDevice)
        var dev = id
        ok = AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, UInt32(MemoryLayout<AudioObjectID>.size), &dev) == noErr
    }
    printJSON(["ok": ok])
    exit(ok ? 0 : 1)
}
let def = defaultOutput()
var out: [[String: Any]] = []
for id in allDevices() {
    let ch = outputChannels(id), n = name(id)
    if ch > 0 && !n.isEmpty { out.append(["name": n, "transport": transport(id), "outputs": ch, "uid": uid(id), "default": id == def]) }
}
printJSON(["devices": out])
