import { toJs } from "@Sk";
import PyDefUtils from "PyDefUtils";
import { PyModMap } from "@runtime/runner/py-util";
import { ClassicComponent, ClassicComponentConstructor, _Anvil } from "./ClassicComponent";

/*#
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

interface TimerAnvil {
    timerInterval: number;
    lastTicked: number | null;
    timerHandle: number | null;
    setTimer: () => void;
    clearTimer: () => void;
}

interface Timer extends ClassicComponent<TimerAnvil> {}

const TimerFactory = (pyModule: PyModMap) => {
    const ClassicComponent = pyModule["ClassicComponent"] as ClassicComponentConstructor;

    pyModule["Timer"] = PyDefUtils.mkComponentCls<Timer>(pyModule, "Timer", {
        properties: [
            /*!componentProp(Timer)!1*/ {
                name: "interval",
                type: "number",
                description: "The number of seconds between each tick. 0 switches the timer off.",
                suggested: true,
                pyVal: true,
                defaultValue: new Sk.builtin.float_(0.5),
                set(self, e, pyV) {
                    const v = toJs(pyV);
                    self._anvil.timerInterval = v as number;
                    self._anvil.lastTicked = null;
                    self._anvil.setTimer();
                },
            },
        ],

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!3*/ "Timer", ["universal", "user data"], {
            show: { description: "When this timer's form is shown on the screen (or it is added to a visible form)" },
            hide: {
                description: "When this timer's form is hidden from the screen (or it is removed from a visible form)",
            },
            tick: /*!componentEvent(Timer)!1*/ {
                name: "tick",
                description: "Every [interval] seconds. Does not trigger if [interval] is 0.",
                parameters: [],
                important: true,
                defaultEvent: true,
            },
        }),

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew<Timer>(ClassicComponent, (self) => {
                self._anvil.metadata = { invisible: true };

                self._anvil.clearTimer = () => {
                    if (self._anvil.timerHandle) {
                        clearTimeout(self._anvil.timerHandle);
                    }
                };

                self._anvil.setTimer = () => {
                    const interval = self._anvil.timerInterval * 1000;
                    const lastTicked = self._anvil.lastTicked;
                    const timeToNextTick = lastTicked ? Math.max(1, lastTicked + interval - Date.now()) : interval;

                    self._anvil.clearTimer();

                    if (interval > 0) {
                        self._anvil.timerHandle = setTimeout(() => {
                            if (self._anvil.onPage) {
                                self._anvil.lastTicked = Date.now();
                                return PyDefUtils.raiseEventAsync({}, self, "tick").finally(function () {
                                    self._anvil.setTimer();
                                });
                            }
                        }, timeToNextTick);
                    } else {
                        self._anvil.timerHandle = null;
                    }
                };

                self._anvil.pageEvents = {
                    add() {
                        self._anvil.onPage = true;
                        self._anvil.setTimer();
                    },
                    remove() {
                        self._anvil.onPage = false;
                        self._anvil.clearTimer();
                    },
                };

                self._anvil.timerInterval = toJs(self._anvil.props["interval"]) as number;
                self._anvil.lastTicked = null;
            });
        },
    });
};

export default TimerFactory;

/*!defClass(anvil,Timer,Component)!*/

/*
 * TO TEST:
 *
 *  - New props: interval
 *  - Event groups: universal
 *  - New events: tick
 *
 */
