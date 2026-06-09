import { getCssPrefix } from "@runtime/runner/legacy-features";
import { PyModMap } from "@runtime/runner/py-util";
import {
    chainOrSuspend,
    pyCallable,
    pyCallOrSuspend,
    pyFunc,
    pyIndexError,
    pyNone,
    pyStr,
    Suspension,
    toPy,
} from "@Sk";
import PyDefUtils from "PyDefUtils";
import { ClassicComponentConstructor } from "./ClassicComponent";
import { ClassicContainer } from "./ClassicContainer";
import { Component } from "./Component";

export type Done = false | true | "INVALID";
export type PaginateFn = (child?: Component) => Suspension | [number, any, Done];

export interface PaginatorPage {
    startedAfter: any;
    stoppedAt: any;
    done: Done;
    rowsDisplayed: number;
    currentPage: number;
    currentIndex: number;
}

export interface PaginatorPagination {
    startAfter: any;
    rowQuota: number;
    done?: boolean;
}

interface PaginatorAnvil {
    elements: {
        root: HTMLDivElement;
        childPanel: HTMLDivElement;
        firstPage: HTMLElement;
        prevPage: HTMLElement;
        nextPage: HTMLElement;
        lastPage: HTMLElement;
    };
    pagination: PaginatorPagination;
    paginatorPages?: PaginatorPage[];
    repaginating: boolean;
    ignoreHeight?: boolean;
    lastChildPagination?: any;
    paginate: PaginateFn;
    updatePaginationControls: () => void;
    getPropJS: (prop: string) => any;
}

interface Paginator extends ClassicContainer<PaginatorAnvil> {}

const PaginatorFactory = (pyModule: PyModMap) => {
    const ClassicContainer = pyModule["ClassicContainer"] as ClassicComponentConstructor;

    pyModule["Paginator"] = PyDefUtils.mkComponentCls<Paginator>(pyModule, "Paginator", {
        base: ClassicContainer,

        locals($loc) {
            // TODO: Add .anvil-paginator to component element here rather than in each component.

            let getRowQuota = (self: Paginator) => {
                let rows = self._anvil && self._anvil.getPropJS && self._anvil.getPropJS("rows_per_page");
                if (rows && rows > 0) {
                    return rows;
                } else {
                    return Infinity;
                }
            };

            let setRepaginating = (self: Paginator, repaginating: boolean, ignoreHeight?: boolean) => {
                const prefix = getCssPrefix();
                self._anvil.repaginating = repaginating;
                if (ignoreHeight) {
                    self._anvil.ignoreHeight = true;
                } else if (ignoreHeight === undefined && self._anvil.ignoreHeight) {
                    return;
                } else {
                    self._anvil.ignoreHeight = false;
                }
                if (repaginating) {
                    self._anvil.elements.childPanel.style.minHeight =
                        self._anvil.elements.childPanel.clientHeight + "px";
                    self._anvil.domNode.classList.add(prefix + "paginating");
                } else {
                    self._anvil.domNode.classList.remove(prefix + "paginating");
                    self._anvil.elements.childPanel.style.minHeight = "0px";
                }
            };

            $loc["__new__"] = PyDefUtils.mkNew<Paginator>(ClassicContainer as ClassicComponentConstructor, (self) => {
                self._anvil.pagination = {
                    startAfter: null,
                    rowQuota: getRowQuota(self),
                };

                self._anvil.updatePaginationControls = () => {
                    const prefix = getCssPrefix();
                    const disablePrev = !self._anvil.paginatorPages || self._anvil.paginatorPages.length < 2;
                    self._anvil.elements.firstPage.classList.toggle(prefix + "disabled", disablePrev);
                    self._anvil.elements.prevPage.classList.toggle(prefix + "disabled", disablePrev);
                    const disableNext = self._anvil.pagination.done === true;
                    self._anvil.elements.nextPage.classList.toggle(prefix + "disabled", disableNext);
                    self._anvil.elements.lastPage.classList.toggle(prefix + "disabled", disableNext);
                };
            });

            $loc["jump_to_first_page"] = new pyFunc((self: Paginator) => {
                if (self._anvil.repaginating) {
                    return pyNone;
                }

                self._anvil.ignoreHeight = true;
                setRepaginating(self, true);
                self._anvil.pagination = {
                    startAfter: null,
                    rowQuota: getRowQuota(self),
                };
                delete self._anvil.lastChildPagination;
                return chainOrSuspend(self._anvil.paginate(), ([rows, stoppedAt, done]) => {
                    self._anvil.paginatorPages = [
                        {
                            startedAfter: null,
                            stoppedAt: stoppedAt,
                            done: done,
                            rowsDisplayed: rows,
                            currentPage: 0,
                            currentIndex: 0,
                        },
                    ];
                    self._anvil.updatePaginationControls();
                    setRepaginating(self, false, false);
                    return pyNone;
                });
            });

            $loc["jump_to_last_page"] = new pyFunc((self: Paginator) => {
                if (self._anvil.repaginating) {
                    return pyNone;
                }

                setRepaginating(self, true, true);
                return chainOrSuspend(
                    PyDefUtils.whileOrSuspend(
                        () =>
                            !(
                                self._anvil.paginatorPages &&
                                self._anvil.paginatorPages.length > 0 &&
                                self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1].done
                            ),
                        () =>
                            chainOrSuspend(
                                undefined,
                                () => {
                                    setRepaginating(self, false);
                                },
                                () => pyCallOrSuspend(self.tp$getattr(new pyStr("next_page"))),
                                () => {
                                    setRepaginating(self, true);
                                }
                            )
                    ),
                    () => {
                        setRepaginating(self, false, false);
                        return pyNone;
                    }
                );
            });

            $loc["next_page"] = new pyFunc((self: Paginator) => {
                if (self._anvil.repaginating) {
                    return pyNone;
                }

                let p = self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1];
                if (p && !p.done && self._anvil.paginatorPages) {
                    setRepaginating(self, true);
                    self._anvil.pagination = {
                        startAfter: p.stoppedAt,
                        rowQuota: getRowQuota(self),
                    };
                    let newPage: PaginatorPage = {} as PaginatorPage;
                    self._anvil.paginatorPages.push(newPage);
                    return chainOrSuspend(self._anvil.paginate(), ([rows, stoppedAt, done]) => {
                        newPage.startedAfter = p.stoppedAt;
                        newPage.rowsDisplayed = rows;
                        newPage.stoppedAt = stoppedAt;
                        newPage.done = done;
                        newPage.currentPage = p.currentPage + 1;
                        newPage.currentIndex = p.currentIndex + p.rowsDisplayed;

                        setRepaginating(self, false);
                        self._anvil.updatePaginationControls();
                        return pyNone;
                    });
                }
                return pyNone;
            });

            $loc["previous_page"] = new pyFunc((self: Paginator) => {
                if (self._anvil.repaginating) {
                    return pyNone;
                }
                let p = self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 2];
                if (p && !p.done && self._anvil.paginatorPages) {
                    setRepaginating(self, true);
                    self._anvil.pagination = {
                        startAfter: p.startedAfter,
                        rowQuota: getRowQuota(self),
                    };
                    self._anvil.paginatorPages.pop();
                    return chainOrSuspend(self._anvil.paginate(), ([rows, stoppedAt, done]) => {
                        setRepaginating(self, false);
                        self._anvil.updatePaginationControls();
                        return pyNone;
                    });
                }
                return pyNone;
            });

            $loc["get_page"] = new pyFunc((self: Paginator) => {
                let p = self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1];
                if (p) {
                    return toPy(p.currentPage);
                }
                return pyNone;
            });

            $loc["get_first_index_on_page"] = new pyFunc((self: Paginator) => {
                let p = self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1];
                if (p) {
                    return toPy(p.currentIndex);
                }
                return pyNone;
            });

            $loc["set_page"] = new pyFunc((self: Paginator, page: any) => {
                page = Sk.misceval.asIndexOrThrow(page);
                if (page < 0) {
                    throw new pyIndexError("Cannot use a negative index to set the page");
                }

                const closestPageBefore =
                    self._anvil.paginatorPages &&
                    self._anvil.paginatorPages[Math.min(page, self._anvil.paginatorPages.length - 1)];
                const fns: (() => any)[] = [];
                let startPage = 0;
                if (closestPageBefore != null && self._anvil.paginatorPages) {
                    startPage = closestPageBefore.currentPage;
                    self._anvil.paginatorPages = self._anvil.paginatorPages.slice(0, startPage + 1);

                    fns.push(() => {
                        self._anvil.pagination = {
                            startAfter: closestPageBefore.startedAfter,
                            rowQuota: getRowQuota(self),
                        };
                        return self._anvil.paginate();
                    });
                }
                const nextPageMeth = self.tp$getattr<pyCallable>(new pyStr("next_page"));
                for (let p = startPage; p < page; p++) {
                    fns.push(() => pyCallOrSuspend(nextPageMeth));
                }

                return chainOrSuspend(null, ...fns, () => pyNone);
            });

            $loc["repaginate"] = new pyFunc((self: Paginator) => {
                const paginatorPages = self._anvil.paginatorPages;
                if (paginatorPages && paginatorPages.length > 1) {
                    if (self._anvil.repaginating) return pyNone;
                    let p = paginatorPages[paginatorPages.length - 1];
                    if (p) {
                        setRepaginating(self, true);
                        self._anvil.pagination = {
                            startAfter: p.startedAfter,
                            rowQuota: getRowQuota(self),
                        };
                        self._anvil.lastChildPagination = undefined;
                        return chainOrSuspend(self._anvil.paginate(), ([rows, stoppedAt, done]) => {
                            paginatorPages.splice(paginatorPages.length - 1, 1, {
                                startedAfter: p.startedAfter,
                                rowsDisplayed: rows,
                                stoppedAt: stoppedAt,
                                done: done,
                                currentPage: p.currentPage,
                                currentIndex: p.currentIndex,
                            });
                            setRepaginating(self, false);
                            self._anvil.updatePaginationControls();
                            return pyNone;
                        });
                    }
                } else {
                    const jumpToFirstPageMeth = self.tp$getattr<pyCallable>(new pyStr("jump_to_first_page"));
                    return pyCallOrSuspend(jumpToFirstPageMeth);
                }
                return pyNone;
            });
        },
    });
};

export default PaginatorFactory;
