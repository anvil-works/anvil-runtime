"use strict";

/**
id: richtext
docs_url: /docs/client/components/basic#richtext
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
// import { linkify } from "remarkable/linkify";

// Taken from the default list in the sanitize-html package.
const SAFE_TAGS = [
  "address", "article", "aside", "footer", "header", "h1", "h2", "h3", "h4",
  "h5", "h6", "hgroup", "main", "nav", "section", "blockquote", "dd", "div",
  "dl", "dt", "figcaption", "figure", "hr", "li", "main", "ol", "p", "pre",
  "ul", "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn",
  "em", "i", "kbd", "mark", "q", "rb", "rp", "rt", "rtc", "ruby", "s", "samp",
  "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "caption",
  "col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr",
];

// https://developer.mozilla.org/en-US/docs/Glossary/empty_element
// subset based on the SAFE_TAGS
const EMPTY_TAGS = new Set(["br", "col", "hr", "img", "wbr"]);

const REMOVE_TAGS = new Set(["script", "style"]);

const needsClose = tag => tag !== "p" && tag !== "li";
const ANY = x => true;
const URL = x => /^(\/|_\/theme\/|https?:\/\/)/.test(x);

const allowedTags = {};

for (let t of SAFE_TAGS) { allowedTags[t] = {}; }

// allowedTags["div"] = {}; // was {"class": ANY}, but then realised that we don't actually want content being allowed to "burst its banks"
allowedTags["a"] = { "href": URL };
allowedTags["img"] = { "src": URL };

const escapeHtml = str => str.replace(/[<>&]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
}[tag] || tag));

const escapeHtmlPreservingEntities = str => str.replace(/&(?![a-zA-Z]+;)|<|>|"/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': "&quot;",
}[tag] || tag));

const escapeHtmlPreservingEntitiesAndEscapingBraces = str => str.replace(/&(?![a-zA-Z]+;)|<|>|"|{|}/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '{': '{{',
    '}': '}}'
}[tag] || tag));


const sanitizeHtml = (unsafeHtml, escapeBracesInAttrs) => {
    // Importantly, this regex is *not* safety-critical. If it fails to identify HTML, we miss tags (and render them as escaped text)
    const tagFinder = /([^<]*)(<\s*(\/?)\s*([^\s"''>]*)\s*(([^'">\s]+(?=['">\s])|'[^']*'|"[^"]*"|\s+)*)>)?/g;
    let safeHtml = "";
    const tagStack = [], tagPeek = () => tagStack[tagStack.length - 1];

    let e = escapeHtmlPreservingEntities;
    let m;
    while ((m = tagFinder.exec(unsafeHtml)) !== null) {
        let preText = m[1], _wholeTag = m[2], isClose = m[3], tagName = m[4], attrs = m[5];
        safeHtml += e(preText);
        if (!tagName) { break; }
        tagName = tagName.toLowerCase();

        let allowedAttrs = allowedTags[tagName];
        //console.log("Tag", tagName, "->", allowedAttrs);
        if (REMOVE_TAGS.has(tagName) && !isClose) {
            const re = new RegExp("<\\s*/\\s*" + tagName + "\\s*>", "i");
            console.log(re);
            const closeMatch = unsafeHtml.substring(tagFinder.lastIndex).match(re);
            if (!closeMatch) {
                break;
            } else {
                console.log(closeMatch, closeMatch.index);
                tagFinder.lastIndex += closeMatch.index + closeMatch[0].length
                continue;
            }
        } else if (!allowedAttrs) {
            continue;
        } else if (isClose) {
            while (tagStack.length && tagPeek() !== tagName && !needsClose(tagPeek())) {
                tagStack.pop();
            }
            if (tagStack.length && (tagName === tagPeek())) {
                safeHtml += "</" + e(tagName) + ">";
                tagStack.pop();
            } // else ignore
        } else {
            // OK, parse our tag
            let attrFinder = /([^\s]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'&>]+)\s*|(.+)/g;
            let am;
            let safeAttrs = {};
            while ((am = attrFinder.exec(attrs)) !== null) {
                //tr (4) ["class=x", "class", "x", undefined, index: 0, input: "class=x", groups: undefined]
                let [_, attrName, attrValue, garbage] = am;
                if (garbage) { break; }
                attrName = attrName.toLowerCase();
                if (attrValue[0] === '"' || attrValue[0] === "'") {
                    attrValue = attrValue.substring(1, attrValue.length-1);
                }
                let attrPred = allowedAttrs[attrName];
                //console.log("Attr pred", attrPred, "for", attrName, "=", attrValue);
                if (attrPred && attrPred(attrValue)) {
                    safeAttrs[attrName] = attrValue;
                }
            }
            let safeTag = "<" + tagName;
            for (let attrName in safeAttrs) {
                let attrValue = safeAttrs[attrName];
                safeTag += " " + attrName + "=\"" + (escapeBracesInAttrs ? escapeHtmlPreservingEntitiesAndEscapingBraces(attrValue) : e(attrValue)) + "\"";
            }
            safeTag += ">";
            safeHtml += safeTag;
            if (!EMPTY_TAGS.has(tagName)) {
                // don't push empty tags onto the stack - they shouldn't have children
                tagStack.push(tagName);
            }
        }
        //console.log("Spinning on tags:", m);
    }

    while (tagStack.length) {
        safeHtml += "</" + tagStack.pop() + ">";
    }

    // console.log("Sanitised", unsafeHtml, "to", safeHtml);

    return safeHtml;
};

const mkSlot = (nameAndMaybeFormat) => {
    let [slotName, ...format] = nameAndMaybeFormat.split(":");
    format = format.join(":").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    let flag = null;
    slotName = slotName.replace(/![sr]$/, (m) => {
        flag = m;
        return "";
    });
    return {
        slotName,
        format,
        flag,
        hasComponents: false,
        slotHTML: `<span style="display: inline-block;" x-anvil-slot="${slotName}" className="anvil-always-inline-container"><code class="anvil-slot-name">{${nameAndMaybeFormat}}</code></span>`,
    };
};
const slotRegex = /(?:{{)|(?:}})|(?:{([a-zA-Z0-9\-_ :\!\.%&;^<>]*)})/g;

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
        domNode.appendChild(component._anvil.domNode);
    };

    const updateContent = (self, e) => {
        const content = self._anvil.props.content?.toString() || "";
        const format = self._anvil.props.format?.toString();
        const enableSlots = self._anvil.props.enable_slots?.v;

        let rawText = "";
        let rawHtml = undefined;
        if (format === "markdown") {
            rawHtml = md.render(content);
        } else if (format === "restricted_html") {
            rawHtml = sanitizeHtml(content, !!enableSlots);
        } else {
            rawText = content;
        }

        e.classList.toggle("has-text", !!content);

        // We're about to wipe out the contents of this DOM element, so we need to preserve our children.
        // Start by detaching them, then later we'll put them back.
        const components = self._anvil.components;
        for (let c of components) {
            c.component._anvil.element.detach();
        }

        let html = rawHtml ? rawHtml.trim() : escapeHtml(rawText);
        const slots = (self._anvil.slots = {});
        if (enableSlots) {
            // TODO: Surely there's a nicer way to do this?!
            e.innerHTML = html.replace(slotRegex, (doubleBracket, nameAndMaybeFormat) => {
                if (doubleBracket === "{{") return "{";
                if (doubleBracket === "}}") return "}";
                const { slotName, slotHTML, ...slot } = mkSlot(nameAndMaybeFormat);
                slots[slotName] = slot;
                return slotHTML;
            });
            e.querySelectorAll("[x-anvil-slot]").forEach((domNode) => {
                slots[domNode.getAttribute("x-anvil-slot")].domNode = domNode;
            });
        } else {
            e.innerHTML = html;
        }

        e.style.whiteSpace = rawHtml ? "unset" : "pre-wrap";

        for (let c of components) {
            addComponentToDom(self, c.component, c.layoutProperties);
        }
    }
    
    const strClear = new Sk.builtin.str("clear");
    const strAddComponent = new Sk.builtin.str("add_component");

    const setData = (self, e, data) => {
        const clear = self.tp$getattr(strClear);
        const add_component = self.tp$getattr(strAddComponent);

        const slotsToClearOrReplace = self._anvil.populatedDataSlots || [];
        self._anvil.populatedDataSlots = [];
        const fns = [];

        // Add new components to correct slots.
        if (data instanceof Sk.builtin.dict) {
            for (let [slotName, val] of data.$items()) {
                // Only add values that have valid slot names
                let slot = self._anvil.slots[slotName];
                if (slot) {
                    if (!(val instanceof pyModule["Component"])) {
                        let formatted = Sk.builtin.str.$empty;
                        const reprFlag = slot.flag;
                        try {
                            formatted = Sk.builtin.format(
                                reprFlag === "!r"
                                    ? Sk.builtin.repr(val)
                                    : reprFlag === "!s"
                                    ? new Sk.builtin.str(val)
                                    : val,
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
                    self._anvil.populatedDataSlots.push(slotName);
                    // Clear might suspend
                    slotName = new Sk.builtin.str(slotName);
                    fns.push(() => PyDefUtils.pyCallOrSuspend(clear, [], ["slot", slotName]))
                    fns.push(() => PyDefUtils.pyCallOrSuspend(add_component, [val], ["slot", slotName]))
                }
            }
        } else if (!(Sk.builtin.checkNone(data))) {
            throw new Sk.builtin.TypeError(`data must be a dict or None, not '${Sk.abstr.typeName(data)}'`);
        }

        // Clear all slots we previously filled, but haven't replaced this time.
        for (let slotName of slotsToClearOrReplace) {
            if (self._anvil.populatedDataSlots.indexOf(slotName) === -1) {
                fns.push(() => PyDefUtils.pyCallOrSuspend(clear, [], ["slot", new Sk.builtin.str(slotName)]))
            }
        }
        return Sk.misceval.chain(null, ...fns);              
    }

    pyModule["RichText"] = PyDefUtils.mkComponentCls(pyModule, "RichText", {
        base: pyModule["Container"],

        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(RichText)!2*/ ["text", "layout", "appearance", "tooltip", "user data"], {
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
                type: "string",
                description: "The format of the content of this component.",
                enum: ["markdown", "plain_text", "restricted_html"],
                defaultValue: new Sk.builtin.str("markdown"),
                pyVal: true,
                important: true,
                priority:11,
                set(s,e,v) {
                    updateContent(s, e[0]);
                },
            },
            data: /*!componentProp(RichText)!1*/ {
                name: "data",
                type: "object",
                description: "A dict of data or Components to populate the named content {slots}.",
                dataBindingProp: true,
                defaultValue: Sk.builtin.none.none$,
                initialize: true,
                pyVal: true,
                priority: 12,
                set(self, e, data) {
                    setData(self, e, data);
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
        }),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "RichText", ["universal"]),

        element: (props) => {
            return <PyDefUtils.OuterElement className="anvil-rich-text anvil-inlinable anvil-container" {...props} />;
        },

        locals ($loc) {

            $loc["__new__"] = PyDefUtils.mkNew(pyModule["Container"], (self) => {
                // Store this on self so we can call it from DesignRichText
                self._anvil.updateContent = updateContent;
            });


            /*!defMethod(_,component,slot)!2*/ "Add a component to this panel, in the specified slot"
            $loc["add_component"] = new PyDefUtils.funcWithKwargs(function (kwargs, self, component) {
                pyModule["Container"]._check_no_parent(component);
                return Sk.misceval.chain(Sk.misceval.callsimOrSuspend(pyModule["Container"].prototype.add_component, self, component, kwargs), () => {
                    addComponentToDom(self, component, kwargs);
                    return Sk.builtin.none.none$;
                });
            });

            const removeFromParentStr = new Sk.builtin.str("remove_from_parent");
            /*!defMethod(_,[slot="slot_name"])!2*/ "clear the Rich Text Component of all components or clear a specific slot of components."
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