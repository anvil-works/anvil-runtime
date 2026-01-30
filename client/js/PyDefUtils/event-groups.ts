import { ClassicEventDescription } from "@runtime/components/ClassicComponent";

export interface EventGroup {
    [key: string]: ClassicEventDescription[];
}

/*!eventGroups()!1*/
export const eventGroups: EventGroup = {
    universal: [
        { name: "show", description: "When the {{component}} is shown on the screen", parameters: [] },
        { name: "hide", description: "When the {{component}} is removed from the screen", parameters: [] },
    ],

    focus: [
        { name: "focus", description: "When the {{component}} gets focus", parameters: [] },
        { name: "lost_focus", description: "When the {{component}} loses focus", parameters: [] },
    ],

    mouse: [
        {
            name: "mouse_enter",
            description: "When the mouse cursor enters this component",
            parameters: [
                {
                    name: "x",
                    description: "The x coordinate of the mouse pointer, within this component",
                    important: true,
                },
                {
                    name: "y",
                    description: "The y coordinate of the mouse pointer, within this component",
                    important: true,
                },
            ],
        },
        {
            name: "mouse_leave",
            description: "When the mouse cursor leaves this component",
            parameters: [
                {
                    name: "x",
                    description: "The x coordinate of the mouse pointer relative to this component",
                    important: true,
                },
                {
                    name: "y",
                    description: "The y coordinate of the mouse pointer relative to this component",
                    important: true,
                },
            ],
        },
        {
            name: "mouse_move",
            description: "When the mouse cursor moves over this component",
            parameters: [
                {
                    name: "x",
                    description: "The x coordinate of the mouse pointer within this component",
                    important: true,
                },
                {
                    name: "y",
                    description: "The y coordinate of the mouse pointer within this component",
                    important: true,
                },
            ],
            important: true,
        },
        {
            name: "mouse_down",
            description: "When a mouse button is pressed on this component",
            parameters: [
                {
                    name: "x",
                    description: "The x coordinate of the mouse pointer within this component",
                    important: true,
                },
                {
                    name: "y",
                    description: "The y coordinate of the mouse pointer within this component",
                    important: true,
                },
                {
                    name: "button",
                    description: "The button that was pressed (1 = left, 2 = middle, 3 = right)",
                    important: true,
                },
                {
                    name: "keys",
                    description:
                        "A dictionary of keys including 'shift', 'alt', 'ctrl', 'meta'. " +
                        "Each key's value is a boolean indicating if it was pressed during the click event. " +
                        "The meta key on a mac is the Command key",
                },
            ],
            important: true,
        },
        {
            name: "mouse_up",
            description: "When a mouse button is released on this component",
            parameters: [
                {
                    name: "x",
                    description: "The x coordinate of the mouse pointer within this component",
                    important: true,
                },
                {
                    name: "y",
                    description: "The y coordinate of the mouse pointer within this component",
                    important: true,
                },
                {
                    name: "button",
                    description: "The button that was released (1 = left, 2 = middle, 3 = right)",
                    important: true,
                },
                {
                    name: "keys",
                    description:
                        "A dictionary of keys including 'shift', 'alt', 'ctrl', 'meta'. " +
                        "Each key's value is a boolean indicating if it was pressed during the click event. " +
                        "The meta key on a mac is the Command key",
                    important: false,
                },
            ],
            important: true,
        },
    ],
    mapOverlays: [
        {
            name: "click",
            description: "when an overlay is clicked.",
            parameters: [
                {
                    name: "lat_lng",
                    description: "The position that was clicked.",
                    important: true,
                    pyVal: true,
                },
            ],
            important: true,
            defaultEvent: true,
        },
        {
            name: "dblclick",
            description: "when an overlay is double clicked.",
            parameters: [
                {
                    name: "lat_lng",
                    description: "The position that was double-clicked.",
                    important: true,
                    pyVal: true,
                },
            ],
            important: true,
            defaultEvent: true,
        },
        {
            name: "drag",
            description: "while the user drags an overlay.",
            parameters: [
                {
                    name: "lat_lng",
                    description: "The position of the cursor.",
                    important: true,
                    pyVal: true,
                },
            ],
            important: true,
            defaultEvent: true,
        },
        {
            name: "dragend",
            description: "when the user stops dragging an overlay.",
            parameters: [
                {
                    name: "lat_lng",
                    description: "The position of the cursor.",
                    important: true,
                    pyVal: true,
                },
            ],
            important: true,
            defaultEvent: true,
        },
        {
            name: "dragstart",
            description: "when the user starts dragging an overlay.",
            parameters: [
                {
                    name: "lat_lng",
                    description: "The position of the cursor.",
                    important: true,
                    pyVal: true,
                },
            ],
            important: true,
            defaultEvent: true,
        },
        {
            name: "mousedown",
            description: "for a mousedown on an overlay.",
            parameters: [
                {
                    name: "lat_lng",
                    description: "The position of the cursor.",
                    important: true,
                    pyVal: true,
                },
            ],
            important: true,
            defaultEvent: true,
        },
        {
            name: "mouseout",
            description: "when the mouse leaves the area of an overlay icon.",
            parameters: [
                {
                    name: "lat_lng",
                    description: "The position of the cursor.",
                    important: true,
                    pyVal: true,
                },
            ],
            important: true,
            defaultEvent: true,
        },
        {
            name: "mouseover",
            description: "when the mouse enters the area of an overlay icon.",
            parameters: [
                {
                    name: "lat_lng",
                    description: "The position of the cursor.",
                    important: true,
                    pyVal: true,
                },
            ],
            important: true,
            defaultEvent: true,
        },
        {
            name: "mouseup",
            description: "for a mouseup on an overlay.",
            parameters: [
                {
                    name: "lat_lng",
                    description: "The position of the cursor.",
                    important: true,
                    pyVal: true,
                },
            ],
            important: true,
            defaultEvent: true,
        },
        {
            name: "rightclick",
            description: "for a right-click on an overlay.",
            parameters: [
                {
                    name: "lat_lng",
                    description: "The position of the cursor.",
                    important: true,
                    pyVal: true,
                },
            ],
            important: true,
            defaultEvent: true,
        },
    ],
};
