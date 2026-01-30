/*#
id: richtext
docs_url: /docs/client/components/containers#richtext
title: RichText
tooltip: Learn more about RichText
description: |
  ```python
  c = RichText(text="# This is a title\n\nAnd this is some text")
  ```

  RichText components are useful for displaying rich text on a form. The user cannot edit text in a label.
  Provide content in markdown (the default), plain text, or a safe subset of HTML, setting the 'format' property accordingly.
*/
import { PyModMap } from "@runtime/runner/py-util";
import {
    chainOrSuspend,
    checkNone,
    isTrue,
    pyBool,
    pyCall,
    pyCallable,
    pyCallOrSuspend,
    pyException,
    pyNone,
    pyStr,
    pyType,
    pyTypeError,
    tryCatchOrSuspend,
    typeName,
} from "@Sk";
import PyDefUtils from "PyDefUtils";
import { Remarkable } from "remarkable";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import { ClassicComponentConstructor } from "./ClassicComponent";
import { ClassicContainer } from "./ClassicContainer";
import { Component } from "./Component";
import { validateChild } from "./Container";
import { isInvisibleComponent } from "./helpers";

interface RichTextAnvil {
    elements: { root: HTMLDivElement };
    slots: {
        [slotName: string]: {
            format: string;
            flag: string | null;
            hasComponents: boolean;
            domNode: HTMLSpanElement;
            placeHolder: HTMLElement;
        };
    };
    populatedDataSlots: string[];
    updateContent: (self: RichText, e: HTMLElement) => void;
}

interface RichText extends ClassicContainer<RichTextAnvil> {}

// import { linkify } from "remarkable/linkify"

// Approach taken from bootstrap/src/js/util/sanitizer.js
const EMPTY_SET = new Set();
const URI_ATTRIBUTES = new Set(["background", "cite", "href", "itemtype", "longdesc", "poster", "src", "xlink:href"]);
const ARIA_ATTRIBUTE_PATTERN = /^aria-[\w-]*$/i;
/**
 * A pattern that recognizes URLs that are safe wrt. XSS in URL navigation
 * contexts.
 *
 * Shout-out to Angular https://github.com/angular/angular/blob/15.2.8/packages/core/src/sanitization/url_sanitizer.ts#L38
 */
const SAFE_URL_PATTERN = /^(?!javascript:)(?:[a-z0-9+.-]+:|[^&:/?#]*(?:[/?#]|$))/i;

const ALLOWED_ATTRIBUTES = {
    // Global attributes allowed on any supplied element below.
    // "*": new Set(["class", "dir", "id", "lang", "role", ARIA_ATTRIBUTE_PATTERN]),
    a: new Set(["target", "href", "title", "rel"]),
    img: new Set(["src", /*"srcset",*/ "alt", "title", "width", "height"]),
};

// prettier-ignore-start
const DISALLOWED_TAGS = new Set(["script", "style"]);

// Taken from the default list in the sanitize-html package.
const ALLOWED_TAGS = new Set([
    "address",
    "article",
    "aside",
    "footer",
    "header",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hgroup",
    "main",
    "nav",
    "section",
    "blockquote",
    "dd",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "hr",
    "li",
    "main",
    "ol",
    "p",
    "pre",
    "ul",
    "a",
    "abbr",
    "b",
    "bdi",
    "bdo",
    "br",
    "cite",
    "code",
    "data",
    "dfn",
    "em",
    "i",
    "kbd",
    "mark",
    "q",
    "rb",
    "rp",
    "rt",
    "rtc",
    "ruby",
    "s",
    "samp",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "time",
    "u",
    "var",
    "wbr",
    "caption",
    "col",
    "colgroup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "img",
]);

const ALLOWED_STYLES = new Set([
    "margin",
    "margin-left",
    "margin-top",
    "margin-bottom",
    "margin-right",
    "padding",
    "padding-left",
    "padding-top",
    "padding-bottom",
    "padding-right",
    "font-size",
    "font-family",
    "font-weight",
    "font-style",
    "border",
    "background-color",
    "color",
]);
// prettier-ignore-end

const allowedAttribute = (attribute: Attr, allowedAttributeSet: Set<string>): boolean => {
    const attributeName = attribute.name;
    if (allowedAttributeSet.has(attributeName)) {
        if (URI_ATTRIBUTES.has(attributeName)) {
            return Boolean(SAFE_URL_PATTERN.test(attribute.nodeValue || ""));
        }
        return true;
    }
    return false;
};

const sanitizeStyle = (styleObj: CSSStyleDeclaration): void => {
    for (const nameString of styleObj) {
        if (!ALLOWED_STYLES.has(nameString)) {
            styleObj.removeProperty(nameString);
        }
    }
};

const SLOT_REGEX = /(?:{{)|(?:}})|(?:{([a-zA-Z0-9\-_ :!.%&;^<>'"]*)})/g;

function getSlotNodes(textContent: string, slots: RichTextAnvil["slots"]): (string | HTMLSpanElement)[] | null {
    // fast path things like "\n";
    if (textContent.length < 2) return null;

    const nodes: (string | HTMLSpanElement)[] = [];
    let match: RegExpExecArray | null;
    let prevIndex = 0;

    // we might as well concatenate strings where possible
    const pushOrConcatText = (text: string): void => {
        if (text === "") return;
        const lastIndex = nodes.length - 1;
        if (typeof nodes[lastIndex] === "string") {
            nodes[lastIndex] += text;
        } else {
            nodes.push(text);
        }
    };

    while ((match = SLOT_REGEX.exec(textContent))) {
        const [fullMatch, nameAndMaybeFormat] = match;
        let upTo = match.index;
        if (fullMatch === "{{" || fullMatch === "}}") {
            upTo++;
        }
        pushOrConcatText(textContent.slice(prevIndex, upTo));
        if (nameAndMaybeFormat) {
            nodes.push(mkSlot(nameAndMaybeFormat, slots));
        }
        prevIndex = SLOT_REGEX.lastIndex;
    }

    // we didn't find anything to replace
    if (nodes.length === 0) return null;

    pushOrConcatText(textContent.slice(prevIndex));

    return nodes;
}

function walkTextNodesInsertingSlots(rootNode: Node, slots: RichTextAnvil["slots"]): void {
    const tree = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    let prevNode: Text | null = null;
    let node = tree.nextNode() as Text | null;
    while (node) {
        // we're walking textNodes so we can only access the textContent property
        const replaceNodes = getSlotNodes(node.textContent || "", slots);
        prevNode = node;
        // set node before maybe replacing it in the dom
        node = tree.nextNode() as Text | null;
        if (replaceNodes !== null && prevNode) {
            // text will be inserted as textNodes
            prevNode.replaceWith(...replaceNodes);
        }
    }
}

function sanitizeHtml(unsafeHtml: string): HTMLElement {
    const domParser = new window.DOMParser();
    const inertDocument = domParser.parseFromString(unsafeHtml, "text/html");
    const tree = inertDocument.createTreeWalker(inertDocument.body, NodeFilter.SHOW_ELEMENT);

    let node;
    while ((node = tree.nextNode())) {
        const nodeName = node.nodeName.toLowerCase();

        if (DISALLOWED_TAGS.has(nodeName)) {
            // script and style tags should be removed entirely
            tree.previousNode();
            (node as Element).remove();
            continue;
        }

        if (!ALLOWED_TAGS.has(nodeName)) {
            // use childNodes over children so we keep the inner text nodes
            const childNodes = [...node.childNodes];
            tree.previousNode();
            (node as Element).replaceChildren();
            (node as Element).replaceWith(...childNodes);
            continue;
        }

        const allowedAttributes = (ALLOWED_ATTRIBUTES as any)[nodeName] ?? EMPTY_SET;

        for (const attribute of [...(node as Element).attributes]) {
            const attributeName = attribute.name;
            if (attributeName === "style") {
                sanitizeStyle((node as HTMLElement).style);
            } else if (ARIA_ATTRIBUTE_PATTERN.test(attributeName)) {
                continue;
            } else if (!allowedAttribute(attribute, allowedAttributes)) {
                (node as Element).removeAttribute(attributeName);
            }
        }
    }

    return inertDocument.body;
}

/**
 * @param {string} nameAndMaybeFormat The f-string like expression
 * @param {any} slots Mutates this in place with details about the slot inserted
 * @returns {HTMLSpanElement}
 */
const mkSlot = (nameAndMaybeFormat: string, slots: RichTextAnvil["slots"]): HTMLSpanElement => {
    const formatIndex = nameAndMaybeFormat.indexOf(":");
    let slotName,
        format = "";
    if (formatIndex === -1) {
        slotName = nameAndMaybeFormat;
    } else {
        slotName = nameAndMaybeFormat.slice(0, formatIndex);
        format = nameAndMaybeFormat.slice(formatIndex + 1);
    }
    let flag = null;
    slotName = slotName.replace(/![sr]$/, (m) => {
        flag = m;
        return "";
    });
    const [domNode, { placeHolder }] = (
        <span style="display: inline-block;" x-anvil-slot={slotName} className="anvil-always-inline-container">
            <code refName="placeHolder" class="anvil-slot-name">
                {nameAndMaybeFormat}
            </code>
        </span>
    ) as [HTMLSpanElement, { placeHolder: HTMLElement }];

    slots[slotName] = { format, flag, hasComponents: false, domNode, placeHolder };

    return domNode;
};

const RichTextFactory = (pyModule: PyModMap) => {
    const md = new Remarkable("full", {
        // typographer: true, // Enable smartypants and other sweet transforms e.g. (c)
        breaks: true, // Convert single '\n' in paragraphs into <br>
        // Highlighter function. Should return escaped HTML,
        // or '' if input not changed
        // use highligh.js if it exists in window
        highlight(str: string, lang?: string): string {
            if (typeof (window as any).hljs === "undefined") return "";
            try {
                const hljs = (window as any).hljs;
                if (lang && hljs.getLanguage(lang)) {
                    return hljs.highlight(lang, str).value;
                } else {
                    return hljs.highlightAuto(str).value;
                }
            } catch {
                return ""; // use external default escaping
            }
        },
    });
    // md.use(linkify); // autoconvert URL-like texts to links
    md.renderer.rules.table_open = () => '<table class="table table-striped">\n';

    const addComponentToDom = (self: RichText, component: Component, layoutProps: any): void => {
        const slot = self._anvil.slots[layoutProps["slot"]];
        let domNode: HTMLElement;
        if (slot) {
            domNode = slot.domNode;
            if (!slot.hasComponents && domNode.firstChild) {
                domNode.removeChild(domNode.firstChild);
            }
            slot.hasComponents = true;

            // Only set width if the component is falling into a valid slot
            const width = domNode.classList.contains("anvil-inlinable") ? "" : layoutProps["width"] || "auto";
            domNode.style.width = width ? PyDefUtils.cssLength(width.toString()) : "";
        } else {
            domNode = self._anvil.domNode;
        }
        const domElement = component.anvil$hooks.domElement;
        if (domElement) {
            domNode.appendChild(domElement);
        }
    };

    const updateContent = (self: RichText, e: HTMLElement): void => {
        const content = self._anvil.props.content?.toString() ?? "";
        const format = self._anvil.props.format?.toString();
        const enableSlots = isTrue(self._anvil.props.enable_slots);
        const slots = (self._anvil.slots = {});
        const components = self._anvil.components;

        let rootNode;
        let isText = false;
        if (format === "markdown") {
            rootNode = document.createElement("div");
            rootNode.innerHTML = md.render(content);
        } else if (format === "restricted_html") {
            rootNode = sanitizeHtml(content);
        } else {
            rootNode = document.createElement("div");
            rootNode.innerText = content;
            isText = true;
        }
        // We're about to wipe out the contents of this DOM element, so we need to preserve our children.
        // Start by detaching them, then later we'll put them back.
        for (let c of components) {
            const domElement = c.component.anvil$hooks.domElement;
            if (domElement) {
                domElement.remove();
            }
        }

        if (enableSlots) {
            walkTextNodesInsertingSlots(rootNode, slots);
        }

        e.replaceChildren(...rootNode.childNodes);
        const prefix = getCssPrefix();
        e.classList.toggle(prefix + "has-text", !!content);
        e.style.whiteSpace = isText ? "pre-wrap" : "unset";

        for (let c of components) {
            addComponentToDom(self, c.component, c.layoutProperties);
        }
    };

    const strClear = new pyStr("clear");
    const strAddComponent = new pyStr("add_component");

    const setData = (self: RichText, e: HTMLElement, data: any): any => {
        const clear = self.tp$getattr<pyCallable>(strClear);
        const add_component = self.tp$getattr<pyCallable>(strAddComponent);

        const slotsToClearOrReplace = self._anvil.populatedDataSlots || [];
        self._anvil.populatedDataSlots = [];
        const populatedSlots: string[] = [];
        const fns = [];

        // Add new components to correct slots.
        const updateSlot = (slotName: string, val: any): any => {
            const slot = self._anvil.slots[slotName];
            if (!slot) {
                return;
            }
            if (!(val instanceof Component)) {
                let formatted = pyStr.$empty;
                const reprFlag = slot.flag;
                try {
                    formatted = Sk.builtin.format(
                        reprFlag === "!r" ? Sk.builtin.repr(val) : reprFlag === "!s" ? new pyStr(val) : val,
                        new pyStr(slot.format || "")
                    );
                } catch (e: any) {
                    // For now display empty string and print a warning when formatting fails.
                    Sk.builtin.print([
                        `Warning: Could not format RichText slot value '${val.toString()}' in slot ${slotName} with format string '${
                            slot.format || ""
                        }': ${
                            e instanceof pyException
                                ? new pyStr(e).toString() // use the str representation
                                : e?.message || "Internal error"
                        }`,
                    ]);
                }
                val = pyCall<Component>(pyModule["Label"] as pyType, [], ["text", formatted]);
            }
            populatedSlots.push(slotName);
            // Clear might suspend
            const slotNameStr = new pyStr(slotName);
            return chainOrSuspend(pyCallOrSuspend(clear, [], ["slot", slotNameStr]), () =>
                pyCallOrSuspend(add_component, [val], ["slot", slotNameStr])
            );
        };

        const NO_VAL = new Object();

        if (data.tp$getattr(pyStr.$keys) && data.mp$subscript) {
            for (const slotName of Object.keys(self._anvil.slots)) {
                // ignore errors from getting the slot
                fns.push(
                    () =>
                        tryCatchOrSuspend(
                            () => Sk.abstr.objectGetItem(data, new pyStr(slotName), true),
                            () => {
                                const fns = [];
                                if (slotsToClearOrReplace.includes(slotName) && clear) {
                                    fns.push(() => pyCallOrSuspend(clear, [], ["slot", new pyStr(slotName)]));
                                }
                                fns.push(() => NO_VAL);
                                return chainOrSuspend(null, ...fns);
                            }
                        ),
                    (val: any) => {
                        if (val !== NO_VAL) {
                            return updateSlot(slotName, val);
                        }
                    }
                );
            }
            fns.push(() => {
                // since everything in this function can suspend, only re-assign the populated slots after everything is done
                self._anvil.populatedDataSlots = populatedSlots;
            });
        } else if (checkNone(data)) {
            // Clear all slots we previously filled
            for (const slotName of slotsToClearOrReplace) {
                fns.push(() => pyCallOrSuspend(clear, [], ["slot", new pyStr(slotName)]));
            }
        } else {
            self._anvil.populatedDataSlots = slotsToClearOrReplace; // we didn't clear any slots so put the populated slots back on ._anvil
            throw new pyTypeError(`data must be a mapping or None, not '${typeName(data)}'`);
        }

        return chainOrSuspend(null, ...fns);
    };

    const ClassicContainer = pyModule["ClassicContainer"] as ClassicComponentConstructor;

    pyModule["RichText"] = PyDefUtils.mkComponentCls<RichText>(pyModule, "RichText", {
        base: ClassicContainer,

        properties: PyDefUtils.assembleGroupProperties<RichText>(
            /*!componentProps(RichText)!2*/ ["text", "layout", "layout_spacing", "appearance", "tooltip", "user data"],
            {
                text: { omit: true },
                bold: { omit: true },
                italic: { omit: true },
                underline: { omit: true },
                content: /*!componentProp(RichText)!1*/ {
                    name: "content",
                    type: "string",
                    description:
                        "The content to render in this component, in the format specified by the 'format' property",
                    exampleValue: "# This is a heading",
                    important: true,
                    priority: 10,
                    pyVal: true,
                    // initialize: true, // no need to initialize here since enable_slots initializes the same function
                    defaultValue: pyStr.$empty,
                    set(s, e, v) {
                        updateContent(s, e);
                    },
                    multiline: true,
                    suggested: true,
                },
                format: /*!componentProp(RichText)!1*/ {
                    name: "format",
                    type: "enum",
                    description: "The format of the content of this component.",
                    options: ["markdown", "plain_text", "restricted_html"],
                    defaultValue: new pyStr("markdown"),
                    pyVal: true,
                    important: true,
                    priority: 11,
                    set(s, e) {
                        updateContent(s, e);
                    },
                },
                enable_slots: /*!componentProp(RichText)!1*/ {
                    name: "enable_slots",
                    type: "boolean",
                    description:
                        "If true {braces} in content define slots. If false, braces in content display normally.",
                    defaultValue: pyBool.true$,
                    initialize: true,
                    pyVal: true,
                    priority: 13,
                    set(s, e, v) {
                        updateContent(s, e);
                    },
                },
                data: /*!componentProp(RichText)!1*/ {
                    name: "data",
                    type: "object",
                    description:
                        "A dict of data or Components to populate the named content {slots}. Can also be a dict-like object.",
                    dataBindingProp: true,
                    defaultValue: pyNone,
                    initialize: true,
                    pyVal: true,
                    priority: 12,
                    set(self, e, data) {
                        return setData(self, e, data);
                    },
                },
            }
        ),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "RichText", ["universal"]),

        element: (props) => {
            return <PyDefUtils.OuterElement className="anvil-rich-text anvil-inlinable anvil-container" {...props} />;
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew<RichText>(ClassicContainer, (self) => {
                // Store this on self so we can call it from DesignRichText
                self._anvil.updateContent = updateContent;
            });

            /*!defMethod(_,component,slot)!2*/ ("Add a component to this panel, in the specified slot");
            $loc["add_component"] = new (PyDefUtils.funcWithKwargs as any)(function (
                kwargs: any,
                self: RichText,
                component: Component
            ) {
                validateChild(component);

                return chainOrSuspend(component.anvil$hooks.setupDom(), (elt) => {
                    if (isInvisibleComponent(component)) {
                        return pyModule["ClassicContainer"]._doAddComponent(self, component, kwargs);
                    }
                    addComponentToDom(self, component, kwargs);
                    return pyModule["ClassicContainer"]._doAddComponent(self, component, kwargs, {
                        detachDom() {
                            elt.remove();
                            const { slot: slotName } = kwargs;
                            if (!slotName) return;
                            const slot = self._anvil.slots[slotName];
                            if (!slot) return;
                            if (slot.domNode.children.length) return;
                            slot.hasComponents = false;
                            slot.domNode.appendChild(slot.placeHolder);
                        },
                    });
                });
            });

            const removeFromParentStr = new pyStr("remove_from_parent");
            /*!defMethod(_,[slot="slot_name"])!2*/ ("clear the Rich Text Component of all components or clear a specific slot of components.");
            $loc["clear"] = PyDefUtils.funcWithKwargs(function (kwargs: any, self: RichText) {
                const components = self._anvil.components.slice(0);
                const slot = kwargs["slot"];
                const fns = [];
                components.forEach((c) => {
                    if (!slot || c.layoutProperties["slot"] === slot) {
                        const removeFromParent = c.component.tp$getattr(removeFromParentStr);
                        if (removeFromParent) {
                            fns.push(() => pyCallOrSuspend(removeFromParent));
                        }
                    }
                });
                fns.push(() => pyNone);
                return chainOrSuspend(undefined, ...fns);
            });
        },

        layouts: [
            {
                name: "slot",
                type: "string",
                description: "The name of the content slot where this component will be placed",
                defaultValue: "",
                important: true,
                priority: 0,
            },
            {
                name: "width",
                type: "number",
                description: "The width for an element that is not horizontally self-sizing",
                defaultValue: null,
                important: true,
                priority: 0,
            },
        ],
    });
};

/*!defClass(anvil,RichText,Container)!*/

/** Polyfill for replaceChildren - not supported below Safari 14 so we probably should polyfill - core-js doesn't */

Document.prototype.replaceChildren ??= replaceChildren;
DocumentFragment.prototype.replaceChildren ??= replaceChildren;
Element.prototype.replaceChildren ??= replaceChildren;

function replaceChildren(this: any): void {
    this.innerHTML = "";
    this.append.apply(this, arguments);
}

export default RichTextFactory;
