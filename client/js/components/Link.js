"use strict";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import { setHandled, isHandled } from "./events";
import { getUnsetPadding, setElementPadding } from "@runtime/runner/components-in-js/public-api/property-utils";
var PyDefUtils = require("PyDefUtils");
const { isTrue } = Sk.misceval;

/*#
id: link
docs_url: /docs/client/components/basic#link
title: Link
tooltip: Learn more about Links
description: |
  ```python
  c = Link(text="Go to Anvil",
           url="https://anvil.works")
  self.add_component(c)
  ```

  Links allow users to navigate to different parts of your app, or to other websis entirely. If a Link's `url` property is set, it will open that URL in a new browser tab.

  ```python
  c = Link(text="Click me")
  c.add_event_handler('click', ...)
  ```

  If a link's `url` property is not set, it will not open a new page when it is clicked. It will, however, still trigger the `click` event.

  ```python
  m = BlobMedia('text/plain', 'Hello, world!', name='hello.txt')
  c = Link(text='Open text document', url=m)
  ```
  If a link's `url` property is set to a [Media object](#media), it will open or download that media in a new tab.

  ```python
  def link_1_click(self, **event_args):
    """This method is called when the link is clicked"""
    form1 = Form1()
    open_form(form1)
  ```
  You can link to another Form by setting the `click` event handler to run `open_form` on an instance of the form you want to open.
*/

module.exports = (pyModule) => {

    pyModule["Link"] = PyDefUtils.mkComponentCls(pyModule, "Link", {
        base: pyModule["ColumnPanel"],

        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(Link)!1*/ ["text", "icon" /*"interaction",*/, "tooltip", "user data"], {
            text: {
                suggested: true,
                dataBindingProp: true,
                set(s, e, v) {
                    v = Sk.builtin.checkNone(v) ? "" : v.toString();
                    const prefix = getCssPrefix();
                    const { outer, holder } = s._anvil.elements;
                    outer.classList.toggle(prefix + "has-text", !!v);
                    holder.textContent = v;
                    holder.style.display = v ? "inline-block" : "none";
                },
                inlineEditElement: 'holder',
                group: undefined,
            },
            url: /*!componentProp(Link)!1*/ {
                name: "url",
                type: "string",
                defaultValue: Sk.builtin.str.$empty,
                pyVal: true,
                exampleValue: "https://google.com",
                description: "The target URL of the link. Can be set to a URL string or to a Media object.",
                initialize: true,
                set(self, e, v) {
                    if (self._anvil.urlHandle) {
                        self._anvil.urlHandle.release();
                        self._anvil.urlHandle = null;
                        delete self._anvil.urlHandleName;
                    }

                    if (Sk.builtin.checkNone(v)) {
                        setUrl(self, "");
                    } else if (Sk.builtin.checkString(v)) {
                        setUrl(self, v.toString());
                    } else if (isTrue(Sk.builtin.isinstance(v, pyModule["Media"]))) {
                        return Sk.misceval.chain(PyDefUtils.getUrlForMedia(v), (h) => {
                            self._anvil.urlHandle = h;
                            self._anvil.urlHandleName = v._name;
                            if (self._anvil.onPage) {
                                self._anvil.pageEvents.add();
                            }
                        });
                    }
                },
            },
            text_padding: /*!componentProp(Link)!1*/ {
                group: "layout",
                name: "text_padding",
                type: "padding",
                hidden: localStorage.previewSpacingProperties !== 'true',
                description: "Padding for the link text. Only available in apps that have been migrated to use Layouts.",
                defaultValue: Sk.builtin.none.none$,
                priority: 0,
                set(s, e, v) {
                    setElementPadding(s._anvil.elements.holder, v);
                },
                getUnset(s, e, v) {
                    return getUnsetPadding(s._anvil.elements.holder, v);
                },
            }
        }),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents(Link)!1*/ "Link", ["universal"], {
            click: /*!componentEvent(Link)!1*/ {
                name: "click",
                description: "When the link is clicked",
                parameters: [
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
                defaultEvent: true,
            },
        }),

        element({ col_spacing, ...props }) {
            const prefix = getCssPrefix();
            const outerClass = PyDefUtils.getOuterClass(props);
            const outerStyle = PyDefUtils.getOuterStyle(props);
            const textPaddingStyle = PyDefUtils.getPaddingStyle({padding: props.text_padding});
            const outerAttrs = PyDefUtils.getOuterAttrs(props);
            const initialText = (props.text = Sk.builtin.checkNone(props.text) ? "" : props.text.toString());
            const colSpacing = prefix + "col-padding-" + col_spacing.toString();
            let underlineStyle = "";
            if (isTrue(props.underline)) {
                underlineStyle = "text-decoration: underline;";
            }
            return (
                <a
                    refName="outer"
                    ontouchstart=""
                    href="javascript:void(0)"
                    className={`anvil-inlinable anvil-container ${prefix}column-panel ${outerClass} ${colSpacing}`}
                    rel="noopener noreferrer"
                    style={outerStyle}
                    {...outerAttrs}>
                    <PyDefUtils.IconComponent side="left" {...props} />
                    <div refName="holder" className={`${prefix}link-text` } style={textPaddingStyle + `display: ${ initialText ? 'inline-block' : 'none'}; ${underlineStyle}`}>
                        {Sk.builtin.checkNone(props.text) ? "" : props.text.toString()}
                    </div>
                    <PyDefUtils.IconComponent side="right" {...props} />
                </a>
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ColumnPanel"], (self) => {
                self._anvil.element.on("click", (e) => {
                    if (isHandled(e)) return;
                    setHandled(e);
                    PyDefUtils.raiseEventAsync(
                        { keys: { meta: e.metaKey, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey } },
                        self,
                        "click"
                    );
                });
                self._anvil.pageEvents = {
                    remove() {
                        if (self._anvil.urlHandle) {
                            self._anvil.urlHandle.release();
                        }
                    },
                    add() {
                        if (self._anvil.urlHandle) {
                            return setUrl(self, self._anvil.urlHandle.getUrl(), self._anvil.urlHandleName);
                        }
                    },
                };
            });
        },
    });


    function setUrl(self, url, name = null) {
        const a = self._anvil.domNode;
        if (url) {
            a.setAttribute("href", url);
            a.setAttribute("target", "_blank");
            if (name) {
                a.setAttribute("download", name);
            } else {
                a.removeAttribute("download");
            }
        } else {
            a.setAttribute("href", "javascript:void(0)");
            a.removeAttribute("target");
            a.removeAttribute("download");
        }
    }

};

/*!defClass(anvil,Link,anvil.ColumnPanel)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, interaction, text, appearance
 *  - New props: url
 *  - Override set: text, background, foreground
 *  - Event groups: universal
 *  - New events: click
 *
 */
