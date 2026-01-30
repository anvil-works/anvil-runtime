import { warn } from "@runtime/runner/warnings";

const WRAP_MAP: Record<string, string[]> = {
    thead: ["table"],
    col: ["colgroup", "table"],
    tr: ["tbody", "table"],
    td: ["tr", "tbody", "table"],
};

WRAP_MAP.tbody = WRAP_MAP.tfoot = WRAP_MAP.colgroup = WRAP_MAP.caption = WRAP_MAP.thead;
WRAP_MAP.th = WRAP_MAP.td;

const TAG_NAME_PATTERN = /<([a-z][^/\0>\x20\t\r\n\f]*)/i;

/**
 * Sets `domNode.innerHTML`, ensuring special table-related tags receive the required wrapper elements.
 * Mirrors legacy HtmlPanel behaviour so HtmlForm can reuse the same semantics.
 */
export function setInnerHTMLWithWrapping(domNode: HTMLElement, htmlString: string) {
    domNode.innerHTML = "";

    const match = TAG_NAME_PATTERN.exec(htmlString);
    const tagName = match?.[1].toLowerCase();
    if (!tagName) {
        domNode.innerHTML = htmlString;
        return;
    }

    const wrap = WRAP_MAP[tagName];
    if (!wrap) {
        domNode.innerHTML = htmlString;
        return;
    }

    let tmp: HTMLElement = document.createElement("div");
    for (let i = wrap.length - 1; i >= 0; i -= 1) {
        tmp = tmp.appendChild(document.createElement(wrap[i]));
    }
    tmp.innerHTML = htmlString;
    domNode.append(...tmp.childNodes);
}

export interface SanitizedScript {
    script: HTMLScriptElement;
    textContent: string;
    src: string | null;
    isAsync: boolean;
}

/**
 * Strips scripts out of a fragment so they don't execute during innerHTML assignment.
 * Mirrors the HtmlPanel flow: we blank out text/src so browsers (and the old jquery helpers)
 * don’t eagerly execute the code while we’re still hydrating the DOM.
 */
export function sanitizeScripts(scriptElements: Iterable<HTMLScriptElement>): SanitizedScript[] {
    const scripts: SanitizedScript[] = [];
    for (const script of scriptElements) {
        const textContent = script.textContent ?? "";
        const src = script.getAttribute("src");
        // we will add the textConent and src in the x-anvil-page-added callback
        // this is to prevent jquery append doing it for us!
        const isAsync = script.getAttribute("async") != null;
        // because firefox sets the async property to true for dynamically created scripts
        // div.innerHtml = "<script src='..'></script>" in firefox async is true, chrome it's false
        // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script#compatibility_notes

        // Prevent eager execution when the fragment is inserted. HtmlPanel historically cleared the
        // contents here so the real load happens once the component is mounted and the scripts can run
        // in the normal page context.
        script.textContent = "";
        if (src) {
            script.removeAttribute("src");
        }

        scripts.push({
            script,
            textContent,
            src,
            isAsync,
        });
    }
    return scripts;
}
/**
 * Replays sanitized scripts in DOM order. External scripts are awaited when synchronous or inline,
 * matching the “variation on what jQuery does” behaviour HtmlPanel relied on so globals appear on
 * `window` immediately.
 */
export function loadScripts(scripts: SanitizedScript[]): Promise<void> | undefined {
    if (!scripts.length) {
        return undefined;
    }

    let promise: Promise<void> | undefined;

    for (const descriptor of scripts) {
        const { script: oldScript, textContent, src, isAsync } = descriptor;

        // this is a varaition on what jQuery does
        // it means that functions exist in the window name space when we add them to the dom
        // just adding the component to the dom isn't enough
        // since the script tags were initially added via the jquery html mechanism
        const parentNode = oldScript.isConnected ? oldScript.parentNode : null;
        // The parentNode might be null if the html was replaced before being added to the screen
        // This might happen if anvil.js was used and the innerHTML was changed via dom manipulation
        // if there is no parentNode or domNode.isConnected === false
        // then we shouldn't add the scripts to the dom. (polyfill for isConnected below)

        if (!parentNode) {
            continue;
        }

        const typeValue = oldScript.type || "";
        const isModule = typeValue.toLowerCase() === "module";

        if (src) {
            oldScript.src = src;
        }

        const newScript = document.createElement("script");
        newScript.async = isAsync;
        newScript.textContent = textContent;
        for (const attr of oldScript.attributes) {
            //async and src are fine here, since we've re-set them above
            newScript.setAttribute(attr.name, attr.value);
        }

        if (promise) {
            promise = promise.then(() => {
                parentNode.replaceChild(newScript, oldScript);
            });
        } else {
            parentNode.replaceChild(newScript, oldScript);
        }

        if (parentNode && src && !isModule && !isAsync) {
            const p = new Promise<void>((resolve) => {
                newScript.onload = () => resolve();
                newScript.onerror = () => {
                    warn(`Warning: failed to load script with src: ${src}`);
                    console.error(`error loading ${src}`);
                    resolve();
                };
            });
            promise = promise ? promise.then(() => p) : p;
        }
    }

    return promise;
}

// It doesn't look like isConnected get's polyfilled so do it here
// this is the official polyfill from MDN - remove this when we stop supporting IE
if (!("isConnected" in Node.prototype)) {
    Object.defineProperty(Node.prototype, "isConnected", {
        get() {
            return (
                !this.ownerDocument ||
                !(this.ownerDocument.compareDocumentPosition(this) & this.DOCUMENT_POSITION_DISCONNECTED)
            );
        },
    });
}

// It doesn't look like remove() get's polyfilled so do it here - https://anvil.works/forum/t/detect-internet-explorer/9675
// this is the official polyfill from MDN - remove this when we stop supporting IE
(function (arr) {
    arr.forEach(function (item) {
        if (Object.prototype.hasOwnProperty.call(item, "remove")) {
            return;
        }
        Object.defineProperty(item, "remove", {
            configurable: true,
            enumerable: true,
            writable: true,
            value: function remove() {
                this.parentNode && this.parentNode.removeChild(this);
            },
        });
    });
})([Element.prototype, CharacterData.prototype, DocumentType.prototype].filter(Boolean));
