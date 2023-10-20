import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import Glib from 'gi://GLib';

import * as Utils from './utils.js'

function __decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;

    return c > 3 && r && Object.defineProperty(target, key, r), r;
}

// @ts-nocheck
/// Taken from https://github.com/material-shell/material-shell/blob/main/src/utils/gjs.ts
/// Decorator function to call `GObject.registerClass` with the given class.
/// Use like
/// ```
/// @registerGObjectClass
/// export class MyThing extends GObject.Object { ... }
/// ```
function registerGObjectClass(target) {
    // Note that we use 'hasOwnProperty' because otherwise we would get inherited meta infos.
    // This would be bad because we would inherit the GObjectName too, which is supposed to be unique.
    if (Object.prototype.hasOwnProperty.call(target, "metaInfo")) {
        // eslint-disable-next-line
        // @ts-ignore
        // eslint-disable-next-line
        return GObject.registerClass(target.metaInfo, target);
    }
    else {
        // eslint-disable-next-line
        // @ts-ignore
        return GObject.registerClass(target);
    }
}

class Barrier {
    constructor(position, hitDirection, triggerMode, triggerAction) {
        this.position = position;
        this.hitDirection = hitDirection;
        this.triggerMode = triggerMode;
        this.triggerAction = triggerAction;
    }

    activate() {
        this.pressureBarrier = new Layout.PressureBarrier(this.triggerMode === TriggerMode.Delayed ? 15 : 0, this.triggerMode === TriggerMode.Delayed ? 200 : 0, Shell.ActionMode.NORMAL);
        this.pressureBarrier.connect("trigger", this.onTrigger.bind(this));
        const { x1, x2, y1, y2 } = this.position;
        this.nativeBarrier = new Meta.Barrier({
            display: global.display,
            x1,
            x2,
            y1,
            y2,
            directions: this.hitDirection === HitDirection.FromBottom
                ? Meta.BarrierDirection.POSITIVE_Y
                : Meta.BarrierDirection.NEGATIVE_Y,
        });
        this.pressureBarrier.addBarrier(this.nativeBarrier);
    }

    onTrigger() {
        this.triggerAction();
    }

    dispose() {
        if (!this.nativeBarrier) {
            return;
        }
        this.pressureBarrier?.removeBarrier(this.nativeBarrier);
        this.nativeBarrier.destroy();
        this.nativeBarrier = null;
        this.pressureBarrier?.destroy();
        this.pressureBarrier = null;
    }
}
var HitDirection;
(function (HitDirection) {
    HitDirection[HitDirection["FromTop"] = 0] = "FromTop";
    HitDirection[HitDirection["FromBottom"] = 1] = "FromBottom";
})(HitDirection || (HitDirection = {}));
var TriggerMode;
(function (TriggerMode) {
    TriggerMode[TriggerMode["Instant"] = 0] = "Instant";
    TriggerMode[TriggerMode["Delayed"] = 1] = "Delayed";
})(TriggerMode || (TriggerMode = {}));

class CursorPositionLeaveDetector {
    constructor(position, hitDirection, leaveAction, leaveCondition) {
        this.position = position;
        this.leaveAction = leaveAction;
        this.leaveCondition = leaveCondition;
        this.timeoutId = null;
        this.boundsChecker =
            hitDirection === HitDirection.FromBottom
                ? this.fromBottomBoundsChecker
                : this.fromTopBoundsChecker;
    }

    activate() {
        this.timeoutId = Glib.timeout_add(Glib.PRIORITY_DEFAULT, 400, () => {
            if (!this.isOutOfBounds() || !this.leaveCondition?.()) {
                return Glib.SOURCE_CONTINUE;
            }
            this.leaveAction();

            return Glib.SOURCE_REMOVE;
        });
    }

    dispose() {
        if (this.timeoutId) {
            Glib.source_remove(this.timeoutId);
            this.timeoutId = null;
        }
    }

    isOutOfBounds() {
        let [_, mouse_y, __] = global.get_pointer();

        return this.boundsChecker(mouse_y);
    }

    fromTopBoundsChecker(mouseY) {
        return this.position.y1 < mouseY;
    }

    fromBottomBoundsChecker(mouseY) {
        return this.position.y1 > mouseY;
    }
}

/**
 * Edge detection, hardcoded for top edge, since
 * I don't need anything else at the moment
 */
let HotEdge = class HotEdge extends Clutter.Actor {
    constructor(monitor, leaveOffset, triggerAction, leaveAction, leaveCondition) {
        super();
        this.monitor = monitor;
        this.leaveOffset = leaveOffset;
        this.triggerAction = triggerAction;
        this.leaveAction = leaveAction;
        this.leaveCondition = leaveCondition;
        this.barrier = null;
        this.leaveDetector = null;
        this._isTriggered = false;
        this.connect("destroy", this.dispose.bind(this));
    }

    initialize() {
        const { x, y, width } = this.monitor;
        this.barrier = new Barrier({
            x1: x,
            x2: x + width,
            y1: y + 1,
            y2: y + 1,
        }, HitDirection.FromBottom, TriggerMode.Delayed, this.onEnter.bind(this));
        this.barrier.activate();
    }

    onEnter() {
        if (this._isTriggered) {
            return;
        }
        this._isTriggered = true;
        const { x, y, width } = this.monitor;
        this.leaveDetector = new CursorPositionLeaveDetector({
            x1: x,
            x2: x + width,
            y1: y + this.leaveOffset,
            y2: y + this.leaveOffset,
        }, HitDirection.FromTop, this.onLeave.bind(this), this.leaveCondition);
        this.leaveDetector.activate();
        this.triggerAction();
    }

    onLeave() {
        if (!this._isTriggered) {
            return;
        }
        this._isTriggered = false;
        this.disposeOfLeaveDetector();
        this.leaveAction();
    }

    dispose() {
        this.barrier?.dispose();
        this.barrier = null;
        this.disposeOfLeaveDetector();
    }

    disposeOfLeaveDetector() {
        this.leaveDetector?.dispose();
        this.leaveDetector = null;
    }
};
HotEdge = __decorate([
    registerGObjectClass
], HotEdge);

function isFullscreen(monitor) {
    return monitor.inFullscreen;
}

function isInOverview() {
    const layoutManager = Main.layoutManager;

    return layoutManager._inOverview;
}

let timeoutSourceIds = [];
function delay(milliseconds) {
    return new Promise((resolve) => {
        const timeoutId = Glib.timeout_add(Glib.PRIORITY_DEFAULT, milliseconds, () => {
            removeFinishedTimeoutId(timeoutId);
            resolve(undefined);

            return Glib.SOURCE_REMOVE;
        });
        if (!timeoutSourceIds) {
            timeoutSourceIds = [];
        }
        timeoutSourceIds.push(timeoutId);
    });
}

function removeFinishedTimeoutId(timeoutId) {
    timeoutSourceIds?.splice(timeoutSourceIds.indexOf(timeoutId), 1);
}

function disposeDelayTimeouts() {
    timeoutSourceIds?.forEach((sourceId) => {
        Glib.Source.remove(sourceId);
    });
    timeoutSourceIds = null;
}

const PanelBox$1 = Main.layoutManager.panelBox;

/**
 * On Wayland, making the panel visible is not enough,
 * there is some weird issue that causes the panel to stay invisible,
 * even though it becomes clickable. As a workaround, on Wayland a concealed dumb
 * app with invisible window (always on top) is started. That makes the panel visible.
 */
class WaylandPanelManager {
    constructor(extensionPath) {
        this.extensionPath = extensionPath;
    }

    static createAndInitialize(extensionPath) {
        const manager = new WaylandPanelManager(extensionPath);
        manager.spawnDummyApp();

        return manager;
    }

    showPanel() {
        let panelChildren = Main.layoutManager.panelBox.first_child.get_children();
        for (let c = 0; c < panelChildren.length; c++) {
            if (panelChildren[c].get_style_class_name() != 'panel-corner')
                panelChildren[c].visible = true;
        }
    }

    hidePanel() {
        let panelChildren = Main.layoutManager.panelBox.first_child.get_children();
        for (let c = 0; c < panelChildren.length; c++) {
            if (panelChildren[c].get_style_class_name() != 'panel-corner')
                panelChildren[c].visible = false;
        }
    }

    dispose() {
        //Glib.spawn_command_line_async('pkill -f "marcinjahn.com/dummy-window.js"');
    }

    async spawnDummyApp() {
        //Glib.spawn_command_line_async(`sh -c "GDK_BACKEND=x11 gjs ${this.extensionPath}/dummy-window.js"`);
    }
}

const PanelBox = Main.layoutManager.panelBox;

class X11PanelManager {
    showPanel() {
        let panelChildren = Main.layoutManager.panelBox.first_child.get_children();
        for (let c = 0; c < panelChildren.length; c++) {
            if (panelChildren[c].get_style_class_name() != 'panel-corner')
                panelChildren[c].visible = true;
        }
    }

    hidePanel() {
        let panelChildren = Main.layoutManager.panelBox.first_child.get_children();
        for (let c = 0; c < panelChildren.length; c++) {
            if (panelChildren[c].get_style_class_name() != 'panel-corner')
                panelChildren[c].visible = false;
        }
    }

    dispose() { }
}

function getPanelHeight() {
    return Main.layoutManager.panelBox.get_children()[0].height;
}

function isAnyPanelMenuOpen() {
    const statusArea = Main.layoutManager.panelBox.get_children()[0].statusArea;
    const opennableIndicators = Object.keys(statusArea)
        .filter((indicator) => !!statusArea[indicator].menu)
        .map((indicator) => statusArea[indicator]);

    return (opennableIndicators.filter((indicator) => indicator.menu.isOpen).length > 0);
}

function toggleAnyIndicator() {
    const statusArea = Main.layoutManager.panelBox.get_children()[0].statusArea;
    const opennableIndicators = Object.keys(statusArea)
        .filter((indicator) => !!statusArea[indicator].menu)
        .map((indicator) => statusArea[indicator]);
    const closedIndicators = opennableIndicators.filter((indicator) => !indicator.menu.isOpen);
    if (closedIndicators.length < 1) {
        return;
    }
    closedIndicators[0].menu.toggle();
    closedIndicators[0].menu.toggle();
}

class PeekTopBarOnFullscreenExtension extends Extension {
    constructor() {
        super(...arguments);
        this.hotEdge = null;
        this.hotCornersSub = null;
        this.panelManager = null;
        this._signalHandler = null;
        this._sessionId = null;
    }

    updateVisibility() {
        Main.layoutManager.panelBox.visible = true;
        if (isFullscreen(Main.layoutManager.primaryMonitor) && !(Main.overview._shownState === 'SHOWING' || Main.overview._shownState === 'SHOWN')) {
            let panelChildren = Main.layoutManager.panelBox.first_child.get_children();
            for (let c = 0; c < panelChildren.length; c++) {
                panelChildren[c].visible = false;
            }
        } else {
            let panelChildren = Main.layoutManager.panelBox.first_child.get_children();
            for (let c = 0; c < panelChildren.length; c++) {
                panelChildren[c].visible = true;
            }
        }
    }

    onSessionModeChanged(session) {
        //if (session.currentMode === 'user' || session.parentMode === 'user') {
        //    this.onFullscreenChange();
        //} else 
        if (session.currentMode === 'unlock-dialog') {
            Main.layoutManager.panelBox.visible = true;
            let panelChildren = Main.layoutManager.panelBox.first_child.get_children();
            for (let c = 0; c < panelChildren.length; c++) {
                panelChildren[c].visible = true;
            }
        }
    }

    enable() {
        log(`Enabling extension ${this.uuid}`);
        if (Meta.is_wayland_compositor()) {
            this.panelManager = WaylandPanelManager.createAndInitialize(this.path);
        }
        else {
            this.panelManager = new X11PanelManager();
        }
        const layoutManager = Main.layoutManager;
        this.hotCornersSub = layoutManager.connect("hot-corners-changed", () => {
            this.setupHotEdge();
        });
        this.setupHotEdge();
        for (let a = 0; a < Main.layoutManager._trackedActors.length; a++) {
            if (Main.layoutManager._trackedActors[a].actor.first_child == Main.panel) {
                Main.layoutManager._trackedActors[a].trackFullscreen = false;
                break;
            }
        }

        this._sessionId = Main.sessionMode.connect('updated', this.onSessionModeChanged.bind(this));
        
        Main.overview.connect('showing', this.updateVisibility.bind(this));
        Main.overview.connect('hiding', this.updateVisibility.bind(this));

        this._signalHandler = new Utils.GlobalSignalsHandler();
        this._signalHandler.add([global.display, 'in-fullscreen-changed', this.updateVisibility.bind(this)]);
    }

    setupHotEdge() {
        this.hotEdge?.dispose();
        const primaryMonitor = Main.layoutManager.primaryMonitor;
        this.hotEdge = new HotEdge(primaryMonitor, getPanelHeight(), () => {
            if (!isFullscreen(primaryMonitor)) {
                return;
            }
            this.panelManager?.showPanel();
        }, () => {
            if (!isFullscreen(primaryMonitor) || isInOverview()) {
                toggleAnyIndicator();

                return;
            }
            delay(200).then(() => {
                if (!isFullscreen(primaryMonitor) || isInOverview()) {
                    toggleAnyIndicator();

                    return;
                }
                this.panelManager?.hidePanel();
            });
        }, () => !isAnyPanelMenuOpen() || isInOverview());
        this.hotEdge.initialize();
        Main.layoutManager.hotCorners.push(this.hotEdge);
    }

    disable() {
        log(`Disabling extension ${this.uuid}`);
        this.hotEdge?.dispose();
        this.hotEdge = null;
        Main.layoutManager.disconnect(this.hotCornersSub);
        this.hotCornersSub = null;
        this.panelManager?.dispose();
        this.panelManager = null;
        disposeDelayTimeouts();
        Main.layoutManager._updateHotCorners();
        for (let a = 0; a < Main.layoutManager._trackedActors.length; a++) {
            if (Main.layoutManager._trackedActors[a].actor.first_child == Main.panel) {
                Main.layoutManager._trackedActors[a].trackFullscreen = true;
                break;
            }
        }
    }
}

export { PeekTopBarOnFullscreenExtension as default };