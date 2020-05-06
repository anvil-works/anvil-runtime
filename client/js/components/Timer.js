"use strict";

var PyDefUtils = require("PyDefUtils");

/**
id: timer
docs_url: /docs/client/components/basic#timer
title: Timer
tooltip: Learn more about Timer
description: |
  ```python
  c = Timer(interval=0.1)
  ```

  The timer raises its `tick` event repeatedly, waiting a specified length of time in between each event.

  This allows you to run a particular piece of code repeatedly (for example, updating an animation).

  The timer is an invisible component, meaning that users will not see it on the page when you run the app.

  The `tick` event only fires while the timer is on the page (that is, between the `show` and `hide` events -- see the [Events documentation](/docs/client/components#events) for more details).

*/

module.exports = function(pyModule) {

	pyModule["Timer"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var events = PyDefUtils.assembleGroupEvents(/*!componentEvents()!3*/ "Timer", ["universal", "user data"],
                                                    {show: {description: "When this timer's form is shown on the screen (or it is added to a visible form)"},
                                                     hide: {description: "When this timer's form is hidden from the screen (or it is removed from a visible form)"}});

        /*!componentEvent(Timer)!1*/
        events.push({name: "tick", description: "Every [interval] seconds. Does not trigger if [interval] is 0.",
                     parameters: [], important: true, defaultEvent: true});

		$loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.metadata = {invisible: true};

            self._anvil.clearTimer = function() {
                if (self._anvil.timerHandle) { clearTimeout(self._anvil.timerHandle); }
            };

            self._anvil.setTimer = function() {
                var interval = self._anvil.timerInterval*1000;
                var lastTicked = self._anvil.lastTicked;
                var timeToNextTick = lastTicked ? Math.max(1, lastTicked + interval - Date.now()) : interval;

                self._anvil.clearTimer();

                if (interval > 0) {
                    self._anvil.timerHandle = setTimeout(function() {
                        if (self._anvil.onPage) {
                            self._anvil.lastTicked = Date.now();
                            return PyDefUtils.raiseEventAsync({}, self, "tick").finally(function() {
                                self._anvil.setTimer();
                            });
                        }
                    }, timeToNextTick);
                } else {
                    self._anvil.timerHandle = null;
                }
            };

            self._anvil.pageEvents = {add: function() { self._anvil.onPage = true; self._anvil.setTimer(); },
                                      remove: function() { self._anvil.onPage = false; self._anvil.clearTimer(); }};

        }, pyModule, $loc, [/*!componentProp(Timer)!1*/{
             name: "interval",
             type: "number",
             defaultValue: 0.5,
             description: "The number of seconds between each tick. 0 switches the timer off.",
             suggested: true,
             set: function(self,e,v) {
                 self._anvil.timerInterval = v;
                 self._anvil.lastTicked = null;
                 self._anvil.setTimer();
             }}
        ], events, pyModule["Component"]);

    }, /*!defClass(anvil,Timer,Component)!*/ 'Timer', [pyModule["Component"]]);
};

/*
 * TO TEST:
 *
 *  - New props: interval
 *  - Event groups: universal
 *  - New events: tick
 *
 */
