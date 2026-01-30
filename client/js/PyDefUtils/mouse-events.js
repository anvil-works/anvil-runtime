import { raiseEventAsync } from "./suspension";

export function setupDefaultMouseEvents(self) {
    self._anvil.element.on("mouseenter", (e) => {
        const offset = self._anvil.element.offset();
        raiseEventAsync({ x: e.pageX - offset.left, y: e.pageY - offset.top }, self, "mouse_enter");
    });

    self._anvil.element.on("mouseleave", (e) => {
        const offset = self._anvil.element.offset();
        raiseEventAsync({ x: e.pageX - offset.left, y: e.pageY - offset.top }, self, "mouse_leave");
    });

    self._anvil.element.on("mousemove", (e) => {
        const offset = self._anvil.element.offset();
        raiseEventAsync(
            { x: e.pageX - offset.left, y: e.pageY - offset.top, button: -1 /*e.which is weird/broken*/ },
            self,
            "mouse_move"
        );
    });

    self._anvil.element.on("touchmove", (e) => {
        const offset = self._anvil.element.offset();
        const has_handler = self._anvil.eventHandlers["mouse_move"] !== undefined;
        if (has_handler) {
            const x = e.originalEvent.changedTouches[0].pageX - offset.left;
            const y = e.originalEvent.changedTouches[0].pageY - offset.top;
            raiseEventAsync({ x, y, button: -1 /*e.which is weird/broken*/ }, self, "mouse_move");
            e.stopPropagation();
            e.preventDefault();
        }
    });

    self._anvil.element.on("touchend", (e) => {
        const offset = self._anvil.element.offset();
        const has_handler = self._anvil.eventHandlers["mouse_up"] !== undefined;
        if (has_handler) {
            const x = e.originalEvent.changedTouches[0].pageX - offset.left;
            const y = e.originalEvent.changedTouches[0].pageY - offset.top;
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

    self._anvil.element.on("mouseup", (e) => {
        const offset = self._anvil.element.offset();
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

    self._anvil.element.on("touchstart", (e) => {
        const offset = self._anvil.element.offset();
        const has_handler = self._anvil.eventHandlers["mouse_down"] !== undefined;
        if (has_handler) {
            const x = e.originalEvent.changedTouches[0].pageX - offset.left;
            const y = e.originalEvent.changedTouches[0].pageY - offset.top;
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

    self._anvil.element.on("mousedown", (e) => {
        const offset = self._anvil.element.offset();
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
