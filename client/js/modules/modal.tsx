// Code below adjusted from:
// Vanilla JS Modal compatible with Bootstrap
// modal-vanilla 0.12.0 <https://github.com/KaneCohen/modal-vanilla>
// Copyright 2020 Kane Cohen <https://github.com/KaneCohen>
// Available under BSD-3-Clause license

import {
    addEventHandler,
    Component,
    notifyComponentMounted,
    notifyComponentUnmounted,
} from "@runtime/components/Component";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import { anvilMod, s_add_component } from "@runtime/runner/py-util";
import { chainOrSuspend, pyCallOrSuspend, pyObject, pyStr, Suspension } from "@Sk";
import { asyncToPromise } from "PyDefUtils";

const s_click = new pyStr("click");
const s_alert_footer_buttons = new pyStr("anvil.alerts.FooterButton");

function reflow(element: HTMLElement) {
    element.offsetHeight;
}

type Listener = (this: EventEmitter, ...args: any[]) => Promise<void> | void;

const EVENTS = Symbol();

class EventEmitter {
    [EVENTS]: { [key: string]: Set<Listener> } = {};

    on(event: string, listener: Listener) {
        (this[EVENTS][event] ??= new Set()).add(listener);
    }

    removeListener(event: string, listener: Listener) {
        this[EVENTS][event]?.delete(listener);
    }

    async emit(event: string, ...args: any[]) {
        for (const listener of this[EVENTS][event] ?? []) {
            await listener.apply(this, args);
        }
    }

    once(event: string, listener: Listener) {
        const g = (...args: any[]) => {
            this.removeListener(event, g);
            listener.apply(this, args);
        };
        this.on(event, g);
    }
}

const DEFAULT_OPTIONS = {
    backdrop: true, // Boolean or 'static', Show Modal backdrop blocking content.
    keyboard: true, // Close modal on esc key.
    show: true,
    id: undefined as number | undefined | string,
    large: null as boolean | null,
    title: null as string | null,
    dismissible: true,
    body: true as boolean | string,
    showFooter: false,
    buttons: [] as { text: string; style?: string; onClick?: () => void }[],
};

let ANIMATE_CLASS = "fade";
let ANIMATE_IN_CLASS = "in";

let prefix: string;

function setPrefix() {
    // we only set prefix if our runtime version is greater than 3
    // use a prefix to avoid name css name collisions
    // in versions less than 3 we use bootstrap modal styling so no prefix
    if (prefix != null) return;
    // we could import the data module but this file has to work for both runner3.js and runner.js
    prefix = getCssPrefix();
    ANIMATE_CLASS = prefix + ANIMATE_CLASS;
    ANIMATE_IN_CLASS = prefix + ANIMATE_IN_CLASS;
}

const BACKDROP_TRANSITION = 150;
const TRANSITION = 300;
const KNOWN_ELEMENTS_TO_INERT = ["appGoesHere", "anvil-header", "anvil-badge"];

function calcScrollbarWidth() {
    const outer = document.createElement("div");
    outer.style.visibility = "hidden";
    outer.style.width = "100px";
    document.body.appendChild(outer);

    const outerWidth = outer.offsetWidth;
    outer.style.overflow = "scroll";

    const inner = document.createElement("div");
    inner.style.width = "100%";
    outer.appendChild(inner);

    const width = outerWidth - inner.offsetWidth;
    document.body.removeChild(outer);

    return width;
}

function* getParentNodes(node: HTMLElement | null) {
    if (!node) return;
    yield node;
    while ((node = node.parentNode as HTMLElement)) {
        yield node;
    }
}

type EventHandler<E extends Event> = (e: E) => void;

interface Events {
    keydownHandler: EventHandler<KeyboardEvent>;
    mousedownHandler: EventHandler<MouseEvent>;
    clickHandler: EventHandler<MouseEvent>;
    resizeHandler: EventHandler<UIEvent>;
}

// the default z-index of a bs-modal is 1050 and the backdrop is 1040
// the defaults aren't nice when we have multiple alerts of varying sizes
// we could dynamically adjust these z-index values ... but
// when we dynamically add an alert modal - the backdrop is added to the body before the modal
// keeping modal and backdrop z-index the same works since
// the order of dom nodes on the body looks like: <back-drop/> <modal/> <back-drop/> <modal/> ...
// if we change bootstrap version we need to check this value/implementation
export const BOOTSTRAP_MODAL_BG = 1040;
const ALERT_MODAL_ZINDEX = `z-index: ${BOOTSTRAP_MODAL_BG};`;

interface AlertProps {
    id?: string | number;
    large?: boolean | null;
    title?: string | null;
    showFooter?: boolean;
    dismissible?: boolean;
    body?: boolean | string;
}

const DISPLAY_NONE = { style: "display: none;" };

function AlertModal({ id, large, title, showFooter, dismissible, body }: AlertProps) {
    id = !id ? "alert-modal" : typeof id === "string" ? id : "alert-modal-" + id;
    const bodyVisible = body == null ? DISPLAY_NONE : {};
    const titleVisible = title == null ? DISPLAY_NONE : {};
    const footerVisible = showFooter ? {} : DISPLAY_NONE;
    const closeVisible = dismissible ? {} : DISPLAY_NONE;
    const size = large == null ? "" : `${prefix}modal-${large ? "lg" : "sm"}`;
    const className = `${prefix}modal ${prefix}fade ${prefix}alert-modal`;
    return (
        <div refName="modal" id={id} className={className} style={ALERT_MODAL_ZINDEX}>
            <div refName="modalDialog" tabIndex={0} className={`${prefix}modal-dialog ${size}`}>
                <div refName="modalContent" className={`${prefix}modal-content`}>
                    <div refName="modalHeader" className={`${prefix}modal-header`} {...titleVisible}>
                        <button
                            refName="closeButton"
                            type="button"
                            className={`${prefix}close`}
                            data-dismiss="modal"
                            {...closeVisible}>
                            <span refName="closeIcon" aria-hidden="true">
                                &times;
                            </span>
                            <span refName="closeText" className={`${prefix}sr-only`}>
                                Close
                            </span>
                        </button>
                        <h4 refName="modalTitle" className={`${prefix}modal-title ${prefix}alert-title`}>
                            {title}
                        </h4>
                    </div>
                    <div
                        refName="modalBody"
                        className={`${prefix}modal-body ${typeof body === "string" ? prefix + "alert-text" : ""}`}
                        {...bodyVisible}>
                        {body}
                    </div>
                    <div refName="modalFooter" className={`${prefix}modal-footer`} {...footerVisible} />
                </div>
            </div>
        </div>
    );
}

interface Elements {
    modal: HTMLDivElement;
    modalDialog: HTMLDivElement;
    modalContent: HTMLDivElement;
    modalHeader: HTMLDivElement;
    closeButton: HTMLButtonElement;
    modalTitle: HTMLHeadingElement;
    modalBody: HTMLDivElement;
    modalFooter: HTMLDivElement;
}

class Modal extends EventEmitter {
    static options = DEFAULT_OPTIONS;
    static _activeAlerts: Modal[] = [];

    el: HTMLElement;
    backdrop: HTMLElement;
    elements: Elements;
    content: HTMLDivElement;
    _showFns: (() => pyObject | Suspension)[];
    _hideFns: (() => pyObject | Suspension)[];
    _events: Events = {
        keydownHandler: () => {},
        mousedownHandler: () => {},
        clickHandler: () => {},
        resizeHandler: () => {},
    };
    _isShown = false;
    _pointerInContent = false;
    _scrollbarWidth = calcScrollbarWidth();
    _bodyIsOverflowing = false;
    _originalBodyPad = "";
    _options: typeof DEFAULT_OPTIONS;

    constructor(options: Partial<typeof DEFAULT_OPTIONS> = {}) {
        super();
        setPrefix();

        const o = (this._options = Object.assign({}, Modal.options, options));
        o.showFooter ||= o.buttons.length > 0;

        const [el, elements] = (<AlertModal {...o} />) as [HTMLElement, JSX.Refs];
        this.el = el;
        this.elements = elements as unknown as Elements;

        const backdrop = (this.backdrop = document.createElement("div"));
        backdrop.className = `${prefix}modal-backdrop`;

        this.content = this.elements.modalContent;
        // placeholders
        this._showFns = [];
        this._hideFns = [];
    }
    static async create(options: Partial<typeof DEFAULT_OPTIONS> = {}) {
        const modal = new Modal(options);
        await modal.setup();
        return modal;
    }
    async setup() {
        // creates the python buttons
        const modalFooter = this.elements.modalFooter;
        const buttonDefs = this._options.buttons;
        const hideFns = [];
        const showFns = [];

        const pyButtonPanel = await asyncToPromise(() => pyCallOrSuspend<Component>(anvilMod["HtmlTemplate"]));
        const buttonPanelElement = await asyncToPromise(pyButtonPanel.anvil$hooks.setupDom);

        buttonPanelElement.classList.add("anvil-alert-footer-button-panel");

        const buttonClass = anvilMod["pluggable_ui"].mp$subscript(s_alert_footer_buttons);

        for (const { text, style, onClick } of buttonDefs) {
            const pyButton = await asyncToPromise(() =>
                pyCallOrSuspend<Component>(
                    buttonClass,
                    [],
                    ["text", new pyStr(text), "button_type", new pyStr(style || "default")]
                )
            );
            const hideOnClick = () => {
                onClick?.();
                this.hide();
            };
            await asyncToPromise(() => addEventHandler(pyButton, s_click, hideOnClick));
            await asyncToPromise(() => pyCallOrSuspend(pyButtonPanel.tp$getattr(s_add_component), [pyButton]));
        }

        modalFooter.append(buttonPanelElement);

        hideFns.push(() => notifyComponentUnmounted(pyButtonPanel, true));
        showFns.push(() => notifyComponentMounted(pyButtonPanel, true));

        this._showFns = showFns;
        this._hideFns = hideFns;
    }

    _setEvents() {
        this._events.keydownHandler = this._handleKeydown.bind(this);
        document.body.addEventListener("keydown", this._events.keydownHandler);

        this._events.mousedownHandler = this._handleMousedown.bind(this);
        this.el.addEventListener("mousedown", this._events.mousedownHandler);

        this._events.clickHandler = this._handleClick.bind(this);
        this.el.addEventListener("click", this._events.clickHandler);

        this._events.resizeHandler = this._handleResize.bind(this);
        window.addEventListener("resize", this._events.resizeHandler);
    }

    _handleMousedown(e: MouseEvent) {
        this._pointerInContent = false;
        const nodes = getParentNodes(e.target as HTMLElement | null);
        for (const node of nodes) {
            if (node === this.content) {
                this._pointerInContent = true;
                break;
            }
        }
    }

    _handleClick(e: MouseEvent) {
        const nodes = getParentNodes(e.target as HTMLElement | null);
        for (const node of nodes) {
            if (node.tagName === "HTML") {
                break;
            }
            if (this._options.backdrop !== true && node === this.el) {
                break;
            }
            if (node === this.content) {
                break;
            }
            if (node.getAttribute("data-dismiss") === "modal") {
                this.hide();
                break;
            }

            if (!this._pointerInContent && node === this.el) {
                this.hide();
                break;
            }
        }

        this._pointerInContent = false;
    }

    _handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape" && this._options.keyboard) {
            this.emit("dismiss", this, e);
            this.hide();
        }
    }

    _handleResize(e: UIEvent) {
        this._resize();
    }

    _showElement() {
        const el = this.el;
        reflow(this.el);
        el.classList.add(ANIMATE_IN_CLASS);
        this._resize();

        setTimeout(() => {
            this.emit("shown", this);
        }, TRANSITION);
    }

    _showBackdrop(callback: () => void) {
        if (this._options.backdrop !== false) {
            const backdrop = this.backdrop;
            backdrop.classList.add(ANIMATE_CLASS);
            reflow(backdrop);
            backdrop.classList.add(ANIMATE_IN_CLASS);
        }
        setTimeout(callback, BACKDROP_TRANSITION);
    }
    _createButtons() {}

    async show() {
        if (this._isShown) {
            return;
        }

        this._setEvents();
        this._checkScrollbar();
        this._setScrollbar();

        document.body.classList.add(`${prefix}modal-open`);
        KNOWN_ELEMENTS_TO_INERT.forEach((id) => {
            document.getElementById(id)?.setAttribute("inert", "");
        });
        Modal._activeAlerts.forEach((modal) => {
            modal.elements.modal.setAttribute("inert", "");
        });
        Modal._activeAlerts.push(this);

        const el = this.el;
        el.style.display = "block";
        el.scrollTop = 0;

        if (this._options.backdrop !== false) {
            document.body.appendChild(this.backdrop);
        }
        if (!el.isConnected) {
            document.body.appendChild(el);
        }
        this._isShown = true;

        this._showBackdrop(() => this._showElement());

        // do this after show backdrop otherwise the backdrop flashes oddly
        (document.activeElement as HTMLElement)?.blur?.();
        this.elements.modalDialog.focus();
        await asyncToPromise(() => chainOrSuspend(null, ...this._showFns));
        await this.emit("show", this);

        return this;
    }

    async toggle() {
        return await (this._isShown ? this.hide() : this.show());
    }

    _resize() {
        const el = this.el;
        const modalIsOverflowing = el.scrollHeight > document.documentElement.clientHeight;
        el.style.paddingLeft = !this._bodyIsOverflowing && modalIsOverflowing ? this._scrollbarWidth + "px" : "";
        el.style.paddingRight = this._bodyIsOverflowing && !modalIsOverflowing ? this._scrollbarWidth + "px" : "";
    }

    async hide() {
        if (!this._isShown) {
            return;
        }
        const o = this._options;
        const backdrop = this.backdrop;
        const elClassList = this.el.classList;
        this._isShown = false;

        this.emit("hide", this);

        elClassList.remove(ANIMATE_IN_CLASS);

        if (o.backdrop) {
            backdrop.classList.remove(ANIMATE_IN_CLASS);
        }

        this._removeEvents();
        Modal._activeAlerts = Modal._activeAlerts.filter((x) => x !== this);
        if (!Modal._activeAlerts.length) {
            document.body.classList.remove(`${prefix}modal-open`);
            KNOWN_ELEMENTS_TO_INERT.forEach((id) => {
                document.getElementById(id)?.removeAttribute("inert");
            });
        } else {
            const active = Modal._activeAlerts[Modal._activeAlerts.length - 1];
            active.elements.modal.removeAttribute("inert");
            active.elements.modalDialog.focus();
        }

        setTimeout(() => {
            document.body.style.paddingRight = this._originalBodyPad;
        }, BACKDROP_TRANSITION);

        setTimeout(() => {
            if (o.backdrop) {
                backdrop.remove();
            }
            this.el.style.display = "none";
            asyncToPromise(() => chainOrSuspend(null, ...this._hideFns));
            this.emit("hidden", this);
            this.el.remove();
        }, TRANSITION);

        return this;
    }

    _removeEvents() {
        document.body.removeEventListener("keydown", this._events.keydownHandler);

        this.el.removeEventListener("mousedown", this._events.mousedownHandler);

        this.el.removeEventListener("click", this._events.clickHandler);

        window.removeEventListener("resize", this._events.resizeHandler);
    }

    _checkScrollbar() {
        this._bodyIsOverflowing = document.body.clientWidth < window.innerWidth;
    }

    _setScrollbar() {
        this._originalBodyPad = document.body.style.paddingRight || "";
        if (this._bodyIsOverflowing) {
            const basePadding = parseInt(this._originalBodyPad || "0", 10);
            document.body.style.paddingRight = basePadding + this._scrollbarWidth + "px";
        }
    }
}

export default Modal;

// ideally we wouldn't add this to window BUT the auth.js modules don't go through webpack in the same way
// @ts-ignore
window.anvilModal = Modal;
