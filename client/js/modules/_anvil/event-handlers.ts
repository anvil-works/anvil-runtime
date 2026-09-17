import {
    buildPyClass,
    checkString,
    isTrue,
    pyCallable,
    pyCheckArgsLen,
    pyCheckType,
    pyFunc,
    pyHasAttr,
    pyNone,
    pyObject,
    pyStr,
    pyType,
} from "@Sk";
import { Component, decoratedEventHandlers } from "@runtime/components/Component";
import { PyModMap, s__get__, s__set_name__ } from "@runtime/runner/py-util";

interface EventHandlerDescriptorInstance extends pyObject {
    componentName: string;
    eventName: string;
    pyFn: pyObject;
}

interface HandleInstance extends pyObject {
    componentName: pyStr;
    eventName: pyStr;
}

// The anvil.download() function used to be here, but has moved to anvil.media.download(). The anvil.media module aliases the function back to here for backwards compatibility.

export function createEventHandlerClasses(pyModule: PyModMap) {
    const EventHandlerDescriptor = buildPyClass(
        pyModule,
        function ($gbl, $loc) {
            $loc["__init__"] = new pyFunc(function (
                self: EventHandlerDescriptorInstance,
                componentName: pyStr,
                eventName: pyStr,
                pyFn: pyObject
            ) {
                self.componentName = componentName.toString();
                self.eventName = eventName.toString();
                self.pyFn = pyFn;
                return pyNone;
            });

            $loc["__get__"] = new pyFunc(function (
                self: EventHandlerDescriptorInstance,
                obj: pyObject,
                objtype: pyType
            ) {
                if (isTrue(pyHasAttr(self.pyFn, s__get__))) {
                    const get = self.pyFn.tp$getattr<pyCallable>(s__get__);
                    return get.tp$call([obj, objtype]);
                } else {
                    return self.pyFn;
                }
            });

            $loc["__set_name__"] = new pyFunc(function (
                self: EventHandlerDescriptorInstance,
                pyOwner: pyType<Component>,
                pyName: pyStr
            ) {
                if (isTrue(pyHasAttr(self.pyFn, s__set_name__))) {
                    const setName = self.pyFn.tp$getattr<pyCallable>(s__set_name__);
                    setName.tp$call([pyOwner, pyName]);
                }
                if (!decoratedEventHandlers.has(pyOwner)) {
                    decoratedEventHandlers.set(pyOwner, new Map());
                }
                const formHandlers = decoratedEventHandlers.get(pyOwner)!;
                if (!formHandlers.has(self.componentName)) {
                    formHandlers.set(self.componentName, []);
                }
                const componentHandlers = formHandlers.get(self.componentName)!;
                componentHandlers.push({
                    event: self.eventName,
                    handler: pyName.toString(),
                });
                return pyNone;
            });
        },
        "EventHandlerDescriptor",
        []
    );

    const handle = buildPyClass(
        pyModule,
        function ($gbl, $loc) {
            $loc["__init__"] = new pyFunc(function (self: HandleInstance, ...args: pyObject[]) {
                const [pyComponentName, pyEvent] = args;
                pyCheckArgsLen("handle", args.length, 2, 2);
                pyCheckType("component_name", "string", checkString(pyComponentName));
                pyCheckType("event_name", "string", checkString(pyEvent));
                self.componentName = pyComponentName as pyStr;
                self.eventName = pyEvent as pyStr;
                return pyNone;
            });

            $loc["__call__"] = new pyFunc(function (self: HandleInstance, pyFn: pyObject) {
                return EventHandlerDescriptor.tp$call([self.componentName, self.eventName, pyFn]);
            });
        },
        "handle",
        []
    );

    return { EventHandlerDescriptor, handle };
}
