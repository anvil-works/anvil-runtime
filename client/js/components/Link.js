"use strict";

var PyDefUtils = require("PyDefUtils");

/**
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

  Links allow users to navigate to different parts of your app, or to other websites entirely. If a Link's `url` property is set, it will open that URL in a new browser tab.

  ```python
  c = Link(text="Click me")
  c.set_event_handler('click', ...)
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

module.exports = function(pyModule) {

    pyModule["Link"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(
            /*!componentProps(Link)!1*/["text", "icon"/*"interaction",*/, "tooltip", "user data"],
            {
                text: {
                    suggested: true,
                    set: function(s,e,v) {
                        // use JS's ""-is-falsy behaviour deliberately
                        e.toggleClass("has-text", v ? true : false);
                        e.find('.link-text').first().text(v).css('display', v ? 'inline-block' : 'none');
                    },
                }
            }
        );

        var setUrl = function(self, url, name=null) {
            var e = self._anvil.element;
            if (url) {
                e.attr("href", url).attr("target", "_blank");
                if (name) {
                  e.attr("download", name);
                } else {
                  e.removeAttr("download")
                }
            } else {
                e.attr("href", "javascript:void(0)").removeAttr("target");
                e.removeAttr("download")
            }
        };

        /*!componentProp(Link)!1*/
        properties.push({name: "url", type: "string",
            defaultValue: new Sk.builtin.str(""),
            pyVal: true,
            exampleValue: "https://google.com",
            description: "The target URL of the link. Can be set to a URL string or to a Media object.",
            set: function(self,e,v) {

                if(self._anvil.urlHandle) {
                    self._anvil.urlHandle.release();
                    self._anvil.urlHandle = null;
                    delete self._anvil.urlHandleName;
                }

                if (!v || v === Sk.builtin.none.none$) {
                    setUrl(self, "");
                } else if (Sk.builtin.isinstance(v, Sk.builtin.str).v) {
                    setUrl(self, v.v);
                } else if (Sk.builtin.isinstance(v, pyModule["Media"]).v) {
                    return Sk.misceval.chain(PyDefUtils.getUrlForMedia(v), function(h) {
                        self._anvil.urlHandle = h;
                        self._anvil.urlHandleName = v._name;
                        if (self._anvil.onPage) {
                            self._anvil.pageEvents.add();
                        }
                    });
                }
            }
        });

        var events = PyDefUtils.assembleGroupEvents(/*!componentEvents(Link)!1*/["universal"]);

        /*!componentEvent(Link)!1*/
        events.push({name: "click", description: "When the link is clicked",
                     parameters: [], important: true, defaultEvent: true});

        /*
         * We abandoned the new_tab property because this can lead to loading mixed-mode content in the IDE, which is not allowed.
         * Now all links open in new tabs by default.
         */
         /*
        properties.push({
                name: "new_tab",
                type: "boolean",
                description: "Open the target URL in a new tab",
                defaultValue: false,
                set: function(s,e,v) { e.attr("target", v ? "_blank" : ""); }
            });
        */

        $loc["__init__"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(pyKwargs, self) {
            
            var newBuild = !self._anvil;

            PyDefUtils.addProperties(self, properties, events);

            // The ontouchstart="" is there to make :active work on iOS safari. Sigh.
            self._anvil.element = $('<a ontouchstart="" href="javascript:void(0)" class="anvil-inlinable" rel="noopener noreferrer"><i class="anvil-component-icon fa left"></i><div class="link-text"></div><i class="anvil-component-icon fa right"></i></a>')
                .on("click", PyDefUtils.funcWithPopupOK(function(e) {
                    PyDefUtils.raiseEventAsync({}, self, "click");
                }));

            self._anvil.pageEvents = {
                remove: function() {
                    if (self._anvil.urlHandle) {
                        self._anvil.urlHandle.release();
                    }
                },
                add: function() {
                    if (self._anvil.urlHandle) {
                        setUrl(self, self._anvil.urlHandle.getUrl(), self._anvil.urlHandleName);
                    }
                },
            };
            self._anvil.dataBindingProp = "text";
        
            if (newBuild) {
                return Sk.misceval.callOrSuspend(pyModule["ColumnPanel"].tp$getattr(new Sk.builtin.str("__init__")), undefined, undefined, pyKwargs, self);
            } else {
                return Sk.builtin.none.none$;
            }
        }));

        for (let prop of properties || []) {
            $loc[prop.name] = Sk.misceval.callsim(pyModule['ComponentProperty'], prop.name);
        }
    }, /*!defClass(anvil,Link,ColumnPanel)!*/ 'Link', [pyModule["ColumnPanel"]]);
};

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
