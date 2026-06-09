import PyDefUtils from "PyDefUtils";

export function calculateHeight() {
    let toMeasure = $(".anvil-measure-content").children();

    if (toMeasure.length == 0) {
        toMeasure = $("#components,#appGoesHere,.modal-dialog,.anvil-measure-this");
    }

    let reportHeight = 0;

    toMeasure.each(function (_, e) {
        const jqElement = $(e);
        const extra = jqElement.hasClass("modal-dialog") ? 30 : 0;
        const offset = jqElement.offset()!;
        reportHeight = Math.max(reportHeight, offset.top + jqElement.outerHeight()! + extra);
    });

    return reportHeight;
}

interface HeightHandle {
    x: number;
    y: number;
    width: number;
    height: number;
    cursor: string;
    owner: string;
}

interface HeightHandleGrab {
    mouseY: number;
    originalHandleY: number;
    originalHeight: number;
    originalHeightProp: number;
}

interface HeightHandleDrop {
    properties: Record<string, { height: number }>;
}

interface HeightHandleAnvil {
    componentSpec?: { name: string };
    element: JQuery;
    getHandles?: () => HeightHandle[];
    getPropJS(name: string): string | number | null | undefined;
    handleDrag?: (handle: HeightHandle, grab: HeightHandleGrab, mouseX: number, mouseY: number) => HeightHandle;
    handleDrop?: (handle: HeightHandle, grab: HeightHandleGrab, mouseX: number, mouseY: number) => HeightHandleDrop;
    handleGrab?: (handle: HeightHandle, mouseX: number, mouseY: number) => HeightHandleGrab;
}

export function addHeightHandle(_anvil: HeightHandleAnvil) {
    // only relevant in the designer
    if (!ANVIL_IN_DESIGNER) return;

    _anvil.getHandles = function () {
        const offset = _anvil.element.offset()!;
        const w = _anvil.element.outerWidth()!;
        const h = _anvil.element.outerHeight()!;

        return [
            {
                x: offset.left + w / 2 - 5,
                y: offset.top + h,
                width: 10,
                height: 10,
                cursor: "ns",
                owner: _anvil.componentSpec!.name,
            },
        ];
    };

    _anvil.handleGrab = function (handle, mouseX, mouseY) {
        return {
            mouseY: mouseY,
            originalHandleY: handle.y,
            originalHeight: _anvil.element.height()!,
            originalHeightProp: parseFloat(String(_anvil.getPropJS("height") || _anvil.element.outerHeight())),
        };
    };

    _anvil.handleDrag = function (handle, grab, mouseX, mouseY) {
        const totalDy = mouseY - grab.mouseY;
        handle.y = grab.originalHandleY + totalDy;
        _anvil.element.height(grab.originalHeight + totalDy);

        // Note: updateHeight will be set on PyDefUtils object in index.js if needed
        PyDefUtils.updateHeight?.();
        return handle;
    };

    _anvil.handleDrop = function (handle, grab, mouseX, mouseY) {
        const r: HeightHandleDrop = { properties: {} };
        const totalDy = mouseY - grab.mouseY;

        const selfName = _anvil.componentSpec!.name;
        r.properties[selfName] = {
            height: Math.max(0, grab.originalHeightProp + totalDy),
        };

        return r;
    };
}
