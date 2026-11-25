import ctypes as C
import sys

X = C.CDLL("libX11.so.6")
Xi = C.CDLL("libXi.so.6")
X.XOpenDisplay.restype = C.c_void_p
X.XOpenDisplay.argtypes = [C.c_char_p]
X.XDefaultRootWindow.restype = C.c_ulong
X.XDefaultRootWindow.argtypes = [C.c_void_p]
X.XInternAtom.restype = C.c_ulong
X.XInternAtom.argtypes = [C.c_void_p, C.c_char_p, C.c_int]
X.XSelectInput.argtypes = [C.c_void_p, C.c_ulong, C.c_long]
X.XNextEvent.argtypes = [C.c_void_p, C.c_void_p]
X.XSetInputFocus.argtypes = [C.c_void_p, C.c_ulong, C.c_int, C.c_ulong]
X.XRaiseWindow.argtypes = [C.c_void_p, C.c_ulong]
X.XChangeProperty.argtypes = [C.c_void_p, C.c_ulong, C.c_ulong, C.c_ulong, C.c_int, C.c_int, C.c_void_p, C.c_int]
X.XFlush.argtypes = [C.c_void_p]
X.XSync.argtypes = [C.c_void_p, C.c_int]


class ClientMessage(C.Structure):
    _fields_ = [
        ("type", C.c_int),
        ("serial", C.c_ulong),
        ("send_event", C.c_int),
        ("display", C.c_void_p),
        ("window", C.c_ulong),
        ("message_type", C.c_ulong),
        ("format", C.c_int),
        ("data", C.c_long * 5),
    ]


class Event(C.Union):
    _fields_ = [("type", C.c_int), ("client", ClientMessage), ("pad", C.c_long * 24)]


class DeviceInfo(C.Structure):
    _fields_ = [
        ("deviceid", C.c_int),
        ("name", C.c_char_p),
        ("use", C.c_int),
        ("attachment", C.c_int),
        ("enabled", C.c_int),
        ("num_classes", C.c_int),
        ("classes", C.c_void_p),
    ]


Xi.XIQueryDevice.argtypes = [C.c_void_p, C.c_int, C.POINTER(C.c_int)]
Xi.XIQueryDevice.restype = C.POINTER(DeviceInfo)

display = X.XOpenDisplay(None)
if not display:
    sys.exit("cannot open DISPLAY")
root = X.XDefaultRootWindow(display)

if sys.argv[1:] == ["masters"]:
    count = C.c_int()
    devices = Xi.XIQueryDevice(display, 0, C.byref(count))
    for index in range(count.value):
        if devices[index].use in (1, 2):
            print(devices[index].name.decode())
    sys.exit(0)

active = X.XInternAtom(display, b"_NET_ACTIVE_WINDOW", 0)
window_atom = X.XInternAtom(display, b"WINDOW", 0)
CLIENT_MESSAGE = 33
SUBSTRUCTURE_NOTIFY = 1 << 19
X.XSelectInput(display, root, SUBSTRUCTURE_NOTIFY)
X.XFlush(display)
print("ready", flush=True)
event = Event()
while True:
    X.XNextEvent(display, C.byref(event))
    if event.type != CLIENT_MESSAGE or event.client.message_type != active:
        continue
    target = C.c_ulong(event.client.window)
    X.XRaiseWindow(display, target)
    X.XSetInputFocus(display, target, 2, 0)
    X.XChangeProperty(display, root, active, window_atom, 32, 0, C.byref(target), 1)
    X.XSync(display, 0)
    print("activated", hex(target.value), flush=True)
