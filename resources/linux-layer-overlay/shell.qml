// OpenBot's own Dynamic Island and agent dock, shown as Wayland layers on Hyprland.
//
// OpenBot renders its island and dock pages offscreen (Electron offscreen rendering), exactly as it would
// in its windows, and sends each new frame here; this only shows those frames on the Overlay layer and
// sends the pointer and the keys back. So they look and behave exactly as OpenBot's own windows do, but
// as layers: above every window and panel, on every workspace, and never a window (window rules and
// programs that act on windows, such as snow that settles on them, leave them alone).
//
// Socket at $OPENBOT_LAYER_SOCKET, one JSON object per line.
//   in:  {"type":"frame","surface":"island"|"dock","file":path,"seq":n,"width":w,"height":h}
//        {"type":"mask","surface":...,"rects":[{x,y,width,height}]}   the parts that take the pointer
//        {"type":"cursor","surface":...,"shape":"pointer"|"text"|"default"|...}
//        {"type":"hide","surface":...}
//        {"type":"edge","surface":"dock","edge":"left"|"right"}          OpenBot's dock edge setting
//        {"type":"place","surface":"dock","y":px}                        where OpenBot puts the dock on its output
//   out: {"type":"input","surface":...,"event":<Electron input event>,"screenY":px}   (screenY: for the dock's drag)
//        {"type":"placement","movedAway":bool,"dockEdge":"left"|"right"}
//
// Placement: the primary output ($OPENBOT_LAYER_PRIMARY_OUTPUT, else Hyprland's monitor 0). While it shows
// a fullscreen window, both move to another output, and the dock to that output's outer edge.

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland

ShellRoot {
    id: root
    property int fullscreenTick: 0
    property string openbotDockEdge: "right"     // OpenBot's own dock edge setting

    function send(o) {
        if (!link.connected) return;
        link.write(JSON.stringify(o) + "\n");
        link.flush();
    }

    Socket {
        id: link
        path: Quickshell.env("OPENBOT_LAYER_SOCKET") || ""
        connected: path !== ""
        parser: SplitParser {
            onRead: line => {
                let m;
                try { m = JSON.parse(line); } catch (e) { return; }
                const s = m.surface === "island" ? island : m.surface === "dock" ? dock : null;
                if (!s) return;
                if (m.type === "frame") s.frame(m);
                else if (m.type === "mask") s.rects = m.rects || [];
                else if (m.type === "cursor") s.cursor = m.shape || "default";
                else if (m.type === "hide") s.live = false;
                else if (m.type === "edge") root.openbotDockEdge = m.edge === "left" ? "left" : "right";
                else if (m.type === "place" && s === dock) dock.placeY = Math.max(0, m.y || 0);
            }
        }
        onConnectedChanged: {
            if (connected) root.sendPlacement();
            else if (path !== "") Qt.quit();
        }
    }

    // ── placement ──
    Connections {
        target: Hyprland
        function onRawEvent(event) {
            const n = event.name;
            if (n === "fullscreen" || n.startsWith("workspace") || n.startsWith("focusedmon") || n.startsWith("monitor")
                || n === "closewindow" || n === "openwindow" || n.startsWith("movewindow")) {
                Hyprland.refreshWorkspaces();
                Hyprland.refreshMonitors();
                root.fullscreenTick++;
            }
        }
    }
    function monitorFor(screen) {
        const ms = Hyprland.monitors.values;
        for (let i = 0; i < ms.length; i++) if (ms[i].name === screen.name) return ms[i];
        return null;
    }
    function hasFullscreen(screen) {
        root.fullscreenTick;
        const m = monitorFor(screen);
        const ws = m && m.activeWorkspace;
        return !!(ws && ws.lastIpcObject && ws.lastIpcObject.hasfullscreen);
    }
    readonly property var primaryScreen: {
        root.fullscreenTick;
        const want = Quickshell.env("OPENBOT_LAYER_PRIMARY_OUTPUT");
        const screens = Quickshell.screens;
        if (want) for (let i = 0; i < screens.length; i++) if (screens[i].name === want) return screens[i];
        const ms = Hyprland.monitors.values;
        for (let i = 0; i < ms.length; i++)
            if (ms[i].id === 0) for (let j = 0; j < screens.length; j++) if (screens[j].name === ms[i].name) return screens[j];
        return screens[0];
    }
    readonly property var targetScreen: {
        root.fullscreenTick;
        const p = root.primaryScreen;
        if (!p || !hasFullscreen(p)) return p;
        const others = Quickshell.screens.filter(s => s !== p && !hasFullscreen(s));
        return others.length ? others[0] : p;
    }
    readonly property bool movedAway: targetScreen !== primaryScreen
    // the dock keeps OpenBot's edge on the primary output; on another output it takes that output's far side
    readonly property string dockEdge: !movedAway ? "" : (targetScreen.x < primaryScreen.x ? "left" : "right")
    function sendPlacement() { root.send({ type: "placement", movedAway: root.movedAway, dockEdge: root.dockEdge }); }
    onMovedAwayChanged: sendPlacement()
    onDockEdgeChanged: sendPlacement()

    // ── one surface: OpenBot's frames, with the pointer and keys sent back ──
    component Surface: PanelWindow {
        id: surf
        required property string name
        property bool live: false
        property var rects: []
        property string cursor: "default"
        property int fw: 1
        property int fh: 1
        property bool showA: true
        /** The surface's top on its output: the pointer's height there is this plus the y in the surface. */
        property real topOffset: 0
        function frame(m) {
            surf.fw = m.width; surf.fh = m.height; surf.live = true;
            const url = "file://" + m.file + "?" + m.seq;
            if (surf.showA) imgB.source = url; else imgA.source = url;
        }
        function sendInput(ev) {
            root.send({ type: "input", surface: surf.name, event: ev,
                        screenY: ev.y !== undefined ? Math.round(surf.topOffset + ev.y) : null });
        }
        function held(buttons) {
            const r = [];
            if (buttons & Qt.LeftButton) r.push("leftButtonDown");
            if (buttons & Qt.MiddleButton) r.push("middleButtonDown");
            if (buttons & Qt.RightButton) r.push("rightButtonDown");
            return r;
        }
        function mods(m) {
            const r = [];
            if (m & Qt.ShiftModifier) r.push("shift");
            if (m & Qt.ControlModifier) r.push("control");
            if (m & Qt.AltModifier) r.push("alt");
            if (m & Qt.MetaModifier) r.push("meta");
            return r;
        }
        readonly property var bbox: {
            if (!rects.length) return null;
            let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
            for (const r of rects) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height); }
            return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        }

        screen: root.targetScreen
        visible: live
        color: "transparent"
        exclusionMode: ExclusionMode.Ignore
        implicitWidth: fw
        implicitHeight: fh
        WlrLayershell.layer: WlrLayer.Overlay
        WlrLayershell.namespace: "openbot-" + name
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.OnDemand
        mask: Region {
            x: surf.bbox ? surf.bbox.x : 0
            y: surf.bbox ? surf.bbox.y : 0
            width: surf.bbox ? surf.bbox.width : 0
            height: surf.bbox ? surf.bbox.height : 0
        }

        // double-buffered: the shown frame stays until the next one is decoded, so nothing flickers
        Image { id: imgA; anchors.fill: parent; cache: false; asynchronous: true; smooth: false; visible: surf.showA
            onStatusChanged: if (status === Image.Ready && !surf.showA) surf.showA = true }
        Image { id: imgB; anchors.fill: parent; cache: false; asynchronous: true; smooth: false; visible: !surf.showA
            onStatusChanged: if (status === Image.Ready && surf.showA) surf.showA = false }

        FocusScope {
            anchors.fill: parent
            focus: true
            Keys.onPressed: e => {
                const code = root.keyName(e);
                if (code) surf.sendInput({ type: "keyDown", keyCode: code, modifiers: surf.mods(e.modifiers) });
                if (e.text && e.text.length === 1 && e.text.charCodeAt(0) >= 32 && !(e.modifiers & Qt.ControlModifier))
                    surf.sendInput({ type: "char", keyCode: e.text, modifiers: surf.mods(e.modifiers) });
                e.accepted = true;
            }
            Keys.onReleased: e => {
                const code = root.keyName(e);
                if (code) surf.sendInput({ type: "keyUp", keyCode: code, modifiers: surf.mods(e.modifiers) });
                e.accepted = true;
            }
            MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                acceptedButtons: Qt.LeftButton | Qt.RightButton | Qt.MiddleButton
                cursorShape: surf.cursor === "pointer" || surf.cursor === "hand" ? Qt.PointingHandCursor
                           : surf.cursor === "text" ? Qt.IBeamCursor
                           : surf.cursor === "grab" ? Qt.OpenHandCursor
                           : surf.cursor === "grabbing" ? Qt.ClosedHandCursor
                           : surf.cursor === "not-allowed" ? Qt.ForbiddenCursor : Qt.ArrowCursor
                function btn(b) { return b === Qt.RightButton ? "right" : b === Qt.MiddleButton ? "middle" : "left"; }
                onEntered: surf.sendInput({ type: "mouseEnter", x: Math.round(mouseX), y: Math.round(mouseY) })
                onExited: surf.sendInput({ type: "mouseLeave", x: Math.round(mouseX), y: Math.round(mouseY) })
                onPositionChanged: m => surf.sendInput({ type: "mouseMove", x: Math.round(m.x), y: Math.round(m.y),
                                                         modifiers: surf.mods(m.modifiers).concat(surf.held(m.buttons)) })
                onPressed: m => { parent.forceActiveFocus();
                    surf.sendInput({ type: "mouseDown", x: Math.round(m.x), y: Math.round(m.y), button: btn(m.button), clickCount: 1,
                                     modifiers: surf.mods(m.modifiers).concat(surf.held(m.buttons)) }); }
                onReleased: m => surf.sendInput({ type: "mouseUp", x: Math.round(m.x), y: Math.round(m.y), button: btn(m.button), clickCount: 1, modifiers: surf.mods(m.modifiers) })
                onDoubleClicked: m => surf.sendInput({ type: "mouseDown", x: Math.round(m.x), y: Math.round(m.y), button: btn(m.button), clickCount: 2 })
                onWheel: w => surf.sendInput({ type: "mouseWheel", x: Math.round(w.x), y: Math.round(w.y), deltaX: w.angleDelta.x, deltaY: w.angleDelta.y, canScroll: true })
            }
        }
    }

    function keyName(e) {
        const k = e.key;
        const named = {};
        named[Qt.Key_Return] = "Enter"; named[Qt.Key_Enter] = "Enter"; named[Qt.Key_Backspace] = "Backspace";
        named[Qt.Key_Tab] = "Tab"; named[Qt.Key_Escape] = "Escape"; named[Qt.Key_Delete] = "Delete";
        named[Qt.Key_Left] = "Left"; named[Qt.Key_Right] = "Right"; named[Qt.Key_Up] = "Up"; named[Qt.Key_Down] = "Down";
        named[Qt.Key_Home] = "Home"; named[Qt.Key_End] = "End"; named[Qt.Key_PageUp] = "PageUp"; named[Qt.Key_PageDown] = "PageDown";
        named[Qt.Key_Space] = "Space"; named[Qt.Key_Shift] = "Shift"; named[Qt.Key_Control] = "Control"; named[Qt.Key_Alt] = "Alt";
        if (named[k] !== undefined) return named[k];
        if (k >= Qt.Key_A && k <= Qt.Key_Z) return String.fromCharCode(k);
        if (k >= Qt.Key_0 && k <= Qt.Key_9) return String.fromCharCode(k);
        return e.text && e.text.length === 1 ? e.text : "";
    }

    // the island: top centre of the output
    Surface { id: island; name: "island"; anchors.top: true }
    // the dock: OpenBot's edge, or the far side of another output; vertically centred
    Surface {
        id: dock; name: "dock"
        readonly property string edge: root.dockEdge !== "" ? root.dockEdge : root.openbotDockEdge
        /** Where OpenBot puts the dock (its drag and its saved place); -1 until it says, centred. */
        property real placeY: -1
        anchors.left: edge === "left"
        anchors.right: edge === "right"
        anchors.top: true
        topOffset: {
            const room = Math.max(0, (screen ? screen.height : fh) - fh);
            return placeY < 0 ? Math.round(room / 2) : Math.min(room, Math.round(placeY));
        }
        margins.top: topOffset
    }
}
