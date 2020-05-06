"use strict";

var utils = {};

utils.pDistance = (x, y, x1, y1, x2, y2) => {

    var A = x - x1;
    var B = y - y1;
    var C = x2 - x1;
    var D = y2 - y1;

    var dot = A * C + B * D;
    var len_sq = C * C + D * D;
    var param = -1;
    if (len_sq != 0) //in case of 0 length line
        param = dot / len_sq;

    var xx, yy;

    if (param < 0) {
        xx = x1;
        yy = y1;
    }
    else if (param > 1) {
        xx = x2;
        yy = y2;
    }
    else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }

    var dx = x - xx;
    var dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
};

utils.positionOf = (e,padding=0) => {
    return {
        x: e.offset().left-padding,
        y: e.offset().top-padding,
        width: e.outerWidth()+padding*2,
        height: e.outerHeight()+padding*2,
    };
};

utils.topOf = e => {
    return {
        x: e.offset().left/* + e.outerWidth() * 0.1*/,
        y: e.offset().top,
        width: e.outerWidth()/* *0.8*/,
        height: 0
    };
};

utils.bottomOf = e => {
    return {
        x: e.offset().left/* + e.outerWidth() * 0.1*/,
        y: e.offset().top + e.outerHeight(),
        width: e.outerWidth()/* *0.8*/,
        height: 0
    };
}

utils.getRandomStr = len => {
    var r = '';
    for (var i=0; i<len; i++) {
        r += String.fromCharCode(65 + Math.floor(26*Math.random()));
    }
    return r;
}

utils.distanceToEdge = (element, x, y) => {
    let offset = element.offset();

    // Work out which edge we're nearest to.
    let width = element.outerWidth();
    let height = element.outerHeight();
    let topDistance = utils.pDistance(x, y, offset.left, offset.top, offset.left + width,  offset.top);
    let bottomDistance = utils.pDistance(x, y, offset.left, offset.top + height, offset.left + width, offset.top + height);
    let leftDistance = utils.pDistance(x, y, offset.left, offset.top, offset.left, offset.top + height);
    let rightDistance = utils.pDistance(x, y, offset.left + width, offset.top, offset.left + width, offset.top + height);

    let nearest = "bottom";
    if (topDistance < bottomDistance && topDistance < leftDistance && topDistance < rightDistance)
        nearest = "top";
    else if (leftDistance < rightDistance && leftDistance < bottomDistance)
        nearest = "left";
    else if (rightDistance < bottomDistance)
        nearest = "right";

    let distance = Math.min(topDistance, bottomDistance, leftDistance, rightDistance);

    return [distance, nearest];
}

module.exports = utils;