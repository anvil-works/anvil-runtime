import type { Component } from "@runtime/components/Component";
import { raiseEventAsync } from "./suspension";

type MouseEventComponent = Component & {
    _anvil: {
        element: JQuery;
        eventHandlers: Record<string, unknown>;
    };
};

const getOffset = (element: JQuery) => element.offset() ?? { left: 0, top: 0 };

export function setupDefaultMouseEvents(self: MouseEventComponent) {
    self._anvil.element.on("mouseenter", (e: JQuery.MouseEnterEvent) => {
        const offset = getOffset(self._anvil.element);
        raiseEventAsync({ x: e.pageX - offset.left, y: e.pageY - offset.top }, self, "mouse_enter");
    });

    self._anvil.element.on("mouseleave", (e: JQuery.MouseLeaveEvent) => {
        const offset = getOffset(self._anvil.element);
        raiseEventAsync({ x: e.pageX - offset.left, y: e.pageY - offset.top }, self, "mouse_leave");
    });

    self._anvil.element.on("mousemove", (e: JQuery.MouseMoveEvent) => {
        const offset = getOffset(self._anvil.element);
        raiseEventAsync(
            { x: e.pageX - offset.left, y: e.pageY - offset.top, button: -1 /*e.which is weird/broken*/ },
            self,
            "mouse_move"
        );
    });

    self._anvil.element.on("touchmove", (e: JQuery.TouchMoveEvent) => {
        const offset = getOffset(self._anvil.element);
        const has_handler = self._anvil.eventHandlers["mouse_move"] !== undefined;
        if (has_handler) {
            const x = e.originalEvent!.changedTouches[0].pageX - offset.left;
            const y = e.originalEvent!.changedTouches[0].pageY - offset.top;
            raiseEventAsync({ x, y, button: -1 /*e.which is weird/broken*/ }, self, "mouse_move");
            e.stopPropagation();
            e.preventDefault();
        }
    });

    self._anvil.element.on("touchend", (e: JQuery.TouchEndEvent) => {
        const offset = getOffset(self._anvil.element);
        const has_handler = self._anvil.eventHandlers["mouse_up"] !== undefined;
        if (has_handler) {
            const x = e.originalEvent!.changedTouches[0].pageX - offset.left;
            const y = e.originalEvent!.changedTouches[0].pageY - offset.top;
            raiseEventAsync(
                {
                    x,
                    y,
                    button: e.which,
                    keys: { meta: false, shift: false, ctrl: false, alt: false },
                },
                self,
                "mouse_up"
            );
            e.stopPropagation();
            e.preventDefault();
        }
    });

    self._anvil.element.on("mouseup", (e: JQuery.MouseUpEvent) => {
        const offset = getOffset(self._anvil.element);
        raiseEventAsync(
            {
                x: e.pageX - offset.left,
                y: e.pageY - offset.top,
                button: e.which,
                keys: { meta: e.metaKey, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey },
            },
            self,
            "mouse_up"
        );
    });

    self._anvil.element.on("touchstart", (e: JQuery.TouchStartEvent) => {
        const offset = getOffset(self._anvil.element);
        const has_handler = self._anvil.eventHandlers["mouse_down"] !== undefined;
        if (has_handler) {
            const x = e.originalEvent!.changedTouches[0].pageX - offset.left;
            const y = e.originalEvent!.changedTouches[0].pageY - offset.top;
            raiseEventAsync(
                {
                    x,
                    y,
                    button: e.which,
                    keys: { meta: false, shift: false, ctrl: false, alt: false },
                },
                self,
                "mouse_down"
            );
            e.stopPropagation();
            e.preventDefault();
        }
    });

    self._anvil.element.on("mousedown", (e: JQuery.MouseDownEvent) => {
        const offset = getOffset(self._anvil.element);
        raiseEventAsync(
            {
                x: e.pageX - offset.left,
                y: e.pageY - offset.top,
                button: e.which,
                keys: { meta: e.metaKey, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey },
            },
            self,
            "mouse_down"
        );
    });
}
