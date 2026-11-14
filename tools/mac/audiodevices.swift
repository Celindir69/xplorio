// Sound devices of the Mac as MPD's "osx" output sees them (Core Audio, kAudioObjectPropertyName): its "device" setting
// must match this name exactly. Prints JSON {"devices": [{"name", "transport", "outputs"}]}; only devices that can play.
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

var a = address(kAudioHardwarePropertyDevices)
var size: UInt32 = 0
var out: [[String: Any]] = []
if AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size) == noErr {
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    if AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size, &ids) == noErr {
        for id in ids {
            let ch = outputChannels(id), n = name(id)
            if ch > 0 && !n.isEmpty { out.append(["name": n, "transport": transport(id), "outputs": ch]) }
        }
    }
}
let data = try! JSONSerialization.data(withJSONObject: ["devices": out], options: [])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
