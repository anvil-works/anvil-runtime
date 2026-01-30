export function calculateHeight() {
    var toMeasure = $(".anvil-measure-content").children();


    if (toMeasure.length == 0) {
        toMeasure = $("#components,#appGoesHere,.modal-dialog,.anvil-measure-this");
    }

    var reportHeight = 0;

    toMeasure.each(function(_,e) {
        e = $(e);
        var extra = e.hasClass("modal-dialog") ? 30 : 0;
        reportHeight = Math.max(reportHeight, e.offset().top + e.outerHeight() + extra);
    });

    return reportHeight;
}

export function addHeightHandle(_anvil) {
    // only relevant in the designer
    if (!ANVIL_IN_DESIGNER) return;

    _anvil.getHandles = function() {
        var offset = _anvil.element.offset();
        var w = _anvil.element.outerWidth();
        var h = _anvil.element.outerHeight();

        return [{
            x: offset.left + w/2 - 5,
            y: offset.top+h,
            width: 10,
            height: 10,
            cursor: "ns",
            owner: _anvil.componentSpec.name,
        }];
    };

    _anvil.handleGrab = function(handle, mouseX, mouseY) {
        return {
            mouseY: mouseY,
            originalHandleY: handle.y,
            originalHeight: _anvil.element.height(),
            originalHeightProp: parseFloat(_anvil.getPropJS("height") || _anvil.element.outerHeight()),
        };
    };

    _anvil.handleDrag = function(handle, grab, mouseX, mouseY) {

        var totalDy = mouseY - grab.mouseY;
        handle.y = grab.originalHandleY + totalDy;
        _anvil.element.height(grab.originalHeight + totalDy);

        // Note: updateHeight will be set on PyDefUtils object in index.js if needed
        if (typeof window.PyDefUtils !== 'undefined' && window.PyDefUtils.updateHeight)
            window.PyDefUtils.updateHeight();
        return handle;
    };

    _anvil.handleDrop = function(handle, grab, mouseX, mouseY) {
        var r = { properties: {}};
        var totalDy = mouseY - grab.mouseY;

        var selfName = _anvil.componentSpec.name;
        r.properties[selfName] = {
            height: Math.max(0,grab.originalHeightProp + totalDy),
        };

        return r;
    };
}

