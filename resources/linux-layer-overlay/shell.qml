// OpenBot's own Dynamic Island and agent dock, shown as Wayland layers on Hyprland.
//
// OpenBot renders its island and dock pages offscreen (Electron offscreen rendering), exactly as it would
// in its windows, and sends each new frame here; this only shows those frames on the Overlay layer and
// sends the pointer and the keys back. So they look and behave as OpenBot's own windows do, but as
// layers: above every window and panel, on every workspace, and never a window.
//
// OpenBot decides which displays have an island or a dock, as on the other platforms. Each of its
// windows is one surface here, on the output of the window's display.
//
// Socket at $OPENBOT_LAYER_SOCKET, one JSON object per line.
//   in:  {"type":"surface","surface":id,"kind":"island"|"dock","output":{name,x,y,width,height}}
//        {"type":"frame","surface":id,"file":path,"seq":n,"width":w,"height":h}
//        {"type":"mask","surface":id,"rects":[{x,y,width,height}]}     the parts that take the pointer
//        {"type":"cursor","surface":id,"shape":"pointer"|"text"|"default"|...}
//        {"type":"place","surface":id,"y":px}                          where OpenBot puts the dock on its output
//        {"type":"remove","surface":id}
//        {"type":"edge","edge":"left"|"right"}                          OpenBot's dock edge setting
//   out: {"type":"input","surface":id,"event":<Electron input event>,"screenY":px}   (screenY: for the dock's drag)

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland

ShellRoot {
    id: root
    property string dockEdge: "right"     // OpenBot's own dock edge setting
    // id -> { kind, output, rects, cursor, place, frame }: the last state of each surface
    property var info: ({})
    property var ids: []

    function send(o) {
        if (!link.connected) return;
        link.write(JSON.stringify(o) + "\n");
        link.flush();
    }

    function instanceFor(id) {
        const list = surfaces.instances;
        for (let i = 0; i < list.length; i++) if (list[i].surfaceId === id) return list[i];
        return null;
    }

    // The output of OpenBot's display: by name, then by place, then by size.
    function screenFor(output) {
        const screens = Quickshell.screens;
        if (!output) return screens[0];
        for (let i = 0; i < screens.length; i++)
            if (output.name && (screens[i].name === output.name || screens[i].model === output.name)) return screens[i];
        for (let i = 0; i < screens.length; i++)
            if (screens[i].x === output.x && screens[i].y === output.y) return screens[i];
        for (let i = 0; i < screens.length; i++)
            if (screens[i].width === output.width && screens[i].height === output.height) return screens[i];
        return screens[0];
    }

    function receive(m) {
        if (m.type === "edge") { root.dockEdge = m.edge === "left" ? "left" : "right"; return; }
        const id = m.surface;
        if (typeof id !== "string") return;
        if (m.type === "remove") {
            delete root.info[id];
            root.ids = root.ids.filter(other => other !== id);
            return;
        }
        if (m.type === "surface") {
            const entry = root.info[id] || { rects: [], cursor: "default", place: -1, frame: null };
            entry.kind = m.kind === "dock" ? "dock" : "island";
            entry.output = m.output || null;
            root.info[id] = entry;
            if (root.ids.indexOf(id) < 0) root.ids = root.ids.concat([id]);
        } else {
            const entry = root.info[id];
            if (!entry) return;
            if (m.type === "frame") entry.frame = m;
            else if (m.type === "mask") entry.rects = m.rects || [];
            else if (m.type === "cursor") entry.cursor = m.shape || "default";
            else if (m.type === "place") entry.place = Math.max(0, m.y || 0);
            else return;
        }
        const surface = root.instanceFor(id);
        if (!surface) return;
        if (m.type === "frame") surface.frame(m);
        else surface.sync();
    }

    Socket {
        id: link
        path: Quickshell.env("OPENBOT_LAYER_SOCKET") || ""
        connected: path !== ""
        parser: SplitParser {
            onRead: line => {
                let m;
                try { m = JSON.parse(line); } catch (e) { return; }
                if (m && typeof m === "object") root.receive(m);
            }
        }
        onConnectedChanged: if (!connected && path !== "") Qt.quit()
    }

    // ── one surface: OpenBot's frames, with the pointer and keys sent back ──
    component Surface: PanelWindow {
        id: surf
        required property var modelData
        readonly property string surfaceId: modelData
        property string kind: "island"
        property var output: null
        property bool live: false
        property var rects: []
        property string cursor: "default"
        /** Where OpenBot puts the dock on its output (its drag and its saved place); -1 until it says, centred. */
        property real place: -1
        property int fw: 1
        property int fh: 1
        property bool showA: true
        readonly property bool isDock: kind === "dock"
        /**
         * Where OpenBot's page sits in the surface. The dock's surface is as tall as its output and never
         * moves: only the page moves in it. So the pointer's height on the output is the y in the surface,
         * and it stays right while a drag moves the dock. (A surface that moved with the drag gave pointer
         * heights against its old place until the compositor moved it, and the dock ran ahead of the pointer.)
         */
        readonly property real contentY: {
            if (!isDock) return 0;
            const room = Math.max(0, (screen ? screen.height : fh) - fh);
            return place < 0 ? Math.round(room / 2) : Math.min(room, Math.round(place));
        }
        function sync() {
            const e = root.info[surfaceId];
            if (!e) return;
            surf.kind = e.kind;
            surf.output = e.output;
            surf.rects = e.rects;
            surf.cursor = e.cursor;
            surf.place = e.place;
        }
        function frame(m) {
            surf.fw = m.width; surf.fh = m.height; surf.live = true;
            const url = "file://" + m.file + "?" + m.seq;
            if (surf.showA) imgB.source = url; else imgA.source = url;
        }
        Component.onCompleted: {
            sync();
            const e = root.info[surfaceId];
            if (e && e.frame) frame(e.frame);
        }
        function sendInput(ev) {
            root.send({ type: "input", surface: surf.surfaceId, event: ev,
                        screenY: ev.y !== undefined ? Math.round(surf.contentY + ev.y) : null });
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

        screen: root.screenFor(output)
        visible: live
        color: "transparent"
        exclusionMode: ExclusionMode.Ignore
        implicitWidth: fw
        implicitHeight: fh + contentY
        // the island: top centre of its output; the dock: OpenBot's edge, as tall as its output
        anchors.top: true
        anchors.bottom: isDock
        anchors.left: isDock && root.dockEdge === "left"
        anchors.right: isDock && root.dockEdge === "right"
        WlrLayershell.layer: WlrLayer.Overlay
        WlrLayershell.namespace: "openbot-" + kind
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.OnDemand
        mask: Region {
            x: surf.bbox ? surf.bbox.x : 0
            y: surf.bbox ? surf.contentY + surf.bbox.y : 0
            width: surf.bbox ? surf.bbox.width : 0
            height: surf.bbox ? surf.bbox.height : 0
        }

        // double-buffered: the shown frame stays until the next one is decoded, so nothing flickers
        // the page, where OpenBot puts it in the surface
        Item {
            id: page; x: 0; y: surf.contentY; width: surf.fw; height: surf.fh
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
                    // Return also needs its char: without the keypress, a form does not submit.
                    if (e.text && e.text.length === 1 && (e.text.charCodeAt(0) >= 32 || e.text === "\r") && !(e.modifiers & Qt.ControlModifier))
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

    // one layer per island and dock window of OpenBot
    Variants {
        id: surfaces
        model: root.ids
        delegate: Surface {}
    }
}
