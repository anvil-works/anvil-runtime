"use strict";

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

var PyDefUtils = require("PyDefUtils");

import { Remarkable } from "remarkable";
import { chainOrSuspend, isTrue, pyCallOrSuspend, tryCatchOrSuspend } from "../@Sk";
import { isInvisibleComponent } from "./helpers";
import { validateChild } from "./Container";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import { Component } from "./Component";
// import { linkify } from "remarkable/linkify"

// Approach taken from bootstrap/src/js/util/sanitizer.js
const EMPTY_SET = new Set();
const URI_ATTRIBUTES = new Set(["background", "cite", "href", "itemtype", "longdesc", "poster", "src", "xlink:href"]);
const ARIA_ATTRIBUTE_PATTERN = /^aria-[\w-]*$/i;
/**
 * A pattern that recognizes a commonly useful subset of URLs that are safe.
 * Shout-out to Angular https://github.com/angular/angular/blob/12.2.x/packages/core/src/sanitization/url_sanitizer.ts
 */
//  const SAFE_URL_PATTERN = /^(?:(?:https?|mailto|ftp|tel|file|sms):|[^#&/:?]*(?:[#/?]|$))/i;
const SAFE_URL_PATTERN = /^(\/|_\/theme\/|https?:\/\/)/;

/**
 * A pattern that matches safe data URLs. Only matches image, video and audio types.
 * Shout-out to Angular https://github.com/angular/angular/blob/12.2.x/packages/core/src/sanitization/url_sanitizer.ts
 */
const DATA_URL_PATTERN =
    /^data:(?:image\/(?:bmp|gif|jpeg|jpg|png|tiff|webp)|video\/(?:mpeg|mp4|ogg|webm)|audio\/(?:mp3|oga|ogg|opus));base64,[\d+/a-z]+=*$/i;

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
    "address", "article", "aside", "footer", "header", "h1", "h2", "h3", "h4",
    "h5", "h6", "hgroup", "main", "nav", "section", "blockquote", "dd", "div",
    "dl", "dt", "figcaption", "figure", "hr", "li", "main", "ol", "p", "pre",
    "ul", "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn",
    "em", "i", "kbd", "mark", "q", "rb", "rp", "rt", "rtc", "ruby", "s", "samp",
    "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "caption",
    "col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "img"
]);

const ALLOWED_STYLES = new Set([
    "margin", "margin-left", "margin-top", "margin-bottom", "margin-right",
    "padding", "padding-left", "padding-top", "padding-bottom", "padding-right",
    "font-size", "font-family", "font-weight", "font-style",
    "border", "background-color", "color", 
]);
// prettier-ignore-end

const allowedAttribute = (attribute, allowedAttributeSet) => {
    const attributeName = attribute.name;
    if (allowedAttributeSet.has(attributeName)) {
        if (URI_ATTRIBUTES.has(attributeName)) {
            return Boolean(SAFE_URL_PATTERN.test(attribute.nodeValue) || DATA_URL_PATTERN.test(attribute.nodeValue));
        }
        return true;
    }
    return false;
};

const sanitizeStyle = (styleObj) => {
    for (const nameString of styleObj) {
        if (!ALLOWED_STYLES.has(nameString)) {
            styleObj.removeProperty(nameString);
        }
    }
};

const SLOT_REGEX = /(?:{{)|(?:}})|(?:{([a-zA-Z0-9\-_ :!.%&;^<>'"]*)})/g;

function getSlotNodes(textContent, slots) {
    // fast path things like "\n";
    if (textContent.length < 2) return null;

    const nodes = [];
    let match;
    let prevIndex = 0;

    // we might as well concatenate strings where possible
    const pushOrConcatText = (text) => {
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

function walkTextNodesInsertingSlots(rootNode, slots) {
    const tree = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    let prevNode;
    let node = tree.nextNode();
    while (node) {
        // we're walking textNodes so we can only access the textContent property
        const replaceNodes = getSlotNodes(node.textContent, slots);
        prevNode = node;
        // set node before maybe replacing it in the dom
        node = tree.nextNode();
        if (replaceNodes !== null) {
            // text will be inserted as textNodes
            prevNode.replaceWith(...replaceNodes);
        }
    }
}

function sanitizeHtml(unsafeHtml) {
    const domParser = new window.DOMParser();
    const inertDocument = domParser.parseFromString(unsafeHtml, "text/html");
    const tree = inertDocument.createTreeWalker(inertDocument.body, NodeFilter.SHOW_ELEMENT);

    let node;
    while ((node = tree.nextNode())) {
        const nodeName = node.nodeName.toLowerCase();

        if (DISALLOWED_TAGS.has(nodeName)) {
            // script and style tags should be removed entirely
            tree.previousNode();
            node.remove();
            continue;
        }

        if (!ALLOWED_TAGS.has(nodeName)) {
            // use childNodes over children so we keep the inner text nodes
            const childNodes = [...node.childNodes];
            tree.previousNode();
            node.replaceChildren();
            node.replaceWith(...childNodes);
            continue;
        }

        const allowedAttributes = ALLOWED_ATTRIBUTES[nodeName] ?? EMPTY_SET;

        for (const attribute of [...node.attributes]) {
            const attributeName = attribute.name;
            if (attributeName === "style") {
                sanitizeStyle(node.style);
            } else if (ARIA_ATTRIBUTE_PATTERN.test(attributeName)) {
                continue;
            } else if (!allowedAttribute(attribute, allowedAttributes)) {
                node.removeAttribute(attributeName);
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
const mkSlot = (nameAndMaybeFormat, slots) => {
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
    );

    slots[slotName] = { format, flag, hasComponents: false, domNode, placeHolder };

    return domNode;
};

module.exports = (pyModule) => {

    const md = new Remarkable("full", {
        // typographer: true, // Enable smartypants and other sweet transforms e.g. (c)
        breaks: true, // Convert single '\n' in paragraphs into <br>
        // Highlighter function. Should return escaped HTML,
        // or '' if input not changed
        // use highligh.js if it exists in window
        highlight(str, lang) {
            if (typeof hljs === "undefined") return "";
            try {
                if (lang && window.hljs.getLanguage(lang)) {
                    return window.hljs.highlight(lang, str).value;
                } else {
                    return window.hljs.highlightAuto(str).value;
                }
            } catch {
                return ""; // use external default escaping
            }
        },
    });
    // md.use(linkify); // autoconvert URL-like texts to links
    md.renderer.rules.table_open = () => '<table class="table table-striped">\n';

    const addComponentToDom = (self, component, layoutProps) => {
        const slot = self._anvil.slots[layoutProps["slot"]];
        let domNode;
        if (slot) {
            domNode = slot.domNode;
            if (!slot.hasComponents) domNode.removeChild(domNode.firstChild);
            slot.hasComponents = true;

            // Only set width if the component is falling into a valid slot
            let width = domNode.classList.contains("anvil-inlinable") ? "" : layoutProps["width"] || "auto";
            domNode.style.width = width ? PyDefUtils.cssLength(width.toString()) : null;
        } else {
            domNode = self._anvil.domNode;
        }
        domNode.appendChild(component.anvil$hooks.domElement);
    };

    const updateContent = (self, e) => {
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
            c.component.anvil$hooks.domElement.remove();
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
    
    const strClear = new Sk.builtin.str("clear");
    const strAddComponent = new Sk.builtin.str("add_component");

    const setData = (self, e, data) => {
        const clear = self.tp$getattr(strClear);
        const add_component = self.tp$getattr(strAddComponent);

        const slotsToClearOrReplace = self._anvil.populatedDataSlots || [];
        self._anvil.populatedDataSlots = [];
        const populatedSlots = [];
        const fns = [];

        // Add new components to correct slots.
        const updateSlot = (slotName, val) => {
            const slot = self._anvil.slots[slotName];
            if (!slot) {
                return;
            }
            if (!(val instanceof Component)) {
                let formatted = Sk.builtin.str.$empty;
                const reprFlag = slot.flag;
                try {
                    formatted = Sk.builtin.format(
                        reprFlag === "!r" ? Sk.builtin.repr(val) : reprFlag === "!s" ? new Sk.builtin.str(val) : val,
                        new Sk.builtin.str(slot.format || "")
                    );
                } catch (e) {
                    // For now display empty string and print a warning when formatting fails.
                    Sk.builtin.print([
                        `Warning: Could not format RichText slot value '${val.toString()}' in slot ${slotName} with format string '${
                            slot.format
                        }': ${
                            e instanceof Sk.builtin.Exception
                                ? new Sk.builtin.str(e).toString() // use the str representation
                                : e?.message || "Internal error"
                        }`,
                    ]);
                }
                val = PyDefUtils.pyCall(pyModule["Label"], [], ["text", formatted]);
            }
            populatedSlots.push(slotName);
            // Clear might suspend
            slotName = new Sk.builtin.str(slotName);
            return chainOrSuspend(PyDefUtils.pyCallOrSuspend(clear, [], ["slot", slotName]), () =>
                PyDefUtils.pyCallOrSuspend(add_component, [val], ["slot", slotName])
            );
        };

        const NO_VAL = new Object();

        if (data.tp$getattr(Sk.builtin.str.$keys) && data.mp$subscript) {
            for (const slotName of Object.keys(self._anvil.slots)) {
                // ignore errors from getting the slot
                fns.push(
                    () =>
                        tryCatchOrSuspend(
                            () => Sk.abstr.objectGetItem(data, new Sk.builtin.str(slotName), true),
                            () => {
                                const fns = [];
                                if (slotsToClearOrReplace.includes(slotName)) {
                                    fns.push(() => pyCallOrSuspend(clear, [], ["slot", new Sk.builtin.str(slotName)]));
                                }
                                fns.push(() => NO_VAL);
                                return chainOrSuspend(null, ...fns);
                            }
                        ),
                    (val) => {
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
        } else if (Sk.builtin.checkNone(data)) {
            // Clear all slots we previously filled
            for (const slotName of slotsToClearOrReplace) {
                fns.push(() => PyDefUtils.pyCallOrSuspend(clear, [], ["slot", new Sk.builtin.str(slotName)]));
            }
        } else {
            self._anvil.populatedDataSlots = slotsToClearOrReplace; // we didn't clear any slots so put the populated slots back on ._anvil
            throw new Sk.builtin.TypeError(`data must be a mapping or None, not '${Sk.abstr.typeName(data)}'`);
        }

        return Sk.misceval.chain(null, ...fns);
    };

    pyModule["RichText"] = PyDefUtils.mkComponentCls(pyModule, "RichText", {
        base: pyModule["ClassicContainer"],

        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(RichText)!2*/ ["text", "layout", "layout_spacing", "appearance", "tooltip", "user data"], {
            text: {omit: true},
            bold: {omit: true},
            italic: {omit: true},
            underline: {omit: true},
            content: /*!componentProp(RichText)!1*/ {
                name: "content",
                type: "string",
                description: "The content to render in this component, in the format specified by the 'format' property",
                exampleValue: "# This is a heading",
                important: true,
                priority: 10,
                pyVal: true,
                // initialize: true, // no need to initialize here since enable_slots initializes the same function
                defaultValue: Sk.builtin.str.$empty,
                set(s, e, v) {
                    updateContent(s, e[0]);
                },
                multiline: true,
                suggested: true,
            },
            format: /*!componentProp(RichText)!1*/ {
                name: "format",
                type: "enum",
                description: "The format of the content of this component.",
                options: ["markdown", "plain_text", "restricted_html"],
                defaultValue: new Sk.builtin.str("markdown"),
                pyVal: true,
                important: true,
                priority:11,
                set(s, e) {
                    updateContent(s, e[0]);
                },
            },
            enable_slots: /*!componentProp(RichText)!1*/ {
                name: "enable_slots",
                type: "boolean",
                description: "If true {braces} in content define slots. If false, braces in content display normally.",
                defaultValue: Sk.builtin.bool.true$,
                initialize: true,
                pyVal: true,
                priority: 13,
                set(s,e,v) {
                    updateContent(s, e[0]);
                },
            },
            data: /*!componentProp(RichText)!1*/ {
                name: "data",
                type: "object",
                description: "A dict of data or Components to populate the named content {slots}. Can also be a dict-like object.",
                dataBindingProp: true,
                defaultValue: Sk.builtin.none.none$,
                initialize: true,
                pyVal: true,
                priority: 12,
                set(self, e, data) {
                    return setData(self, e, data);
                },
            },
        }),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "RichText", ["universal"]),

        element: (props) => {
            return <PyDefUtils.OuterElement className="anvil-rich-text anvil-inlinable anvil-container" {...props} />;
        },

        locals ($loc) {

            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicContainer"], (self) => {
                // Store this on self so we can call it from DesignRichText
                self._anvil.updateContent = updateContent;
            });


            /*!defMethod(_,component,slot)!2*/ "Add a component to this panel, in the specified slot";
            $loc["add_component"] = new PyDefUtils.funcWithKwargs(function (kwargs, self, component) {
                validateChild(component);

                return Sk.misceval.chain(component.anvil$hooks.setupDom(), (elt) => {
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

            const removeFromParentStr = new Sk.builtin.str("remove_from_parent");
            /*!defMethod(_,[slot="slot_name"])!2*/ "clear the Rich Text Component of all components or clear a specific slot of components.";
            $loc["clear"] = new PyDefUtils.funcWithKwargs(function (kwargs, self) {
                const components = self._anvil.components.slice(0);
                const slot = kwargs["slot"];
                const fns = [];
                components.forEach((c) => {
                    if (!slot || c.layoutProperties["slot"] === slot) {
                        fns.push(() => PyDefUtils.pyCallOrSuspend(c.component.tp$getattr(removeFromParentStr)));
                    }
                });
                fns.push(() => Sk.builtin.none.none$);
                return Sk.misceval.chain(undefined, ...fns);
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
            }, {
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

function replaceChildren() {
    this.innerHTML = "";
    this.append.apply(this, arguments);
}
