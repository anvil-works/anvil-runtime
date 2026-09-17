import { Suspension, chainOrSuspend, pyFunc, pyIndexError, pyNone, toPy } from "@Sk";
import PyDefUtils from "PyDefUtils";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import { PyModMap } from "@runtime/runner/py-util";
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

export type PageChangeSource = "click" | "code";
export type PageOperation = "first" | "previous" | "next" | "last" | "set_page";

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
    lastChildPagination?: any;
    paginate: PaginateFn;
    updatePaginationControls: () => void;
    getPropJS: (prop: string) => any;
    navigatePage: (operation: PageOperation, source: PageChangeSource, page?: any) => any;
    recoverInvalidPage: () => any;
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

            const getCurrentPage = (self: Paginator) => {
                const p =
                    self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1];
                return p ? p.currentPage : null;
            };

            // Only entry points own navigation and emit events. Private pagination steps,
            // including invalid-page recovery, run inside that navigation without re-entering it.
            const changePage = (
                self: Paginator,
                change: () => any,
                { source = "code", showProgress = true }: { source?: PageChangeSource; showProgress?: boolean } = {}
            ) => {
                if (self._anvil.repaginating) {
                    return pyNone;
                }
                const previousPage = getCurrentPage(self);
                const prefix = getCssPrefix();
                self._anvil.repaginating = true;
                if (showProgress) {
                    self._anvil.domNode.classList.add(prefix + "paginating");
                    self._anvil.elements.childPanel.style.minHeight =
                        self._anvil.elements.childPanel.clientHeight + "px";
                }
                return chainOrSuspend(
                    PyDefUtils.pyTryFinally(change, () => {
                        self._anvil.repaginating = false;
                        self._anvil.domNode.classList.remove(prefix + "paginating");
                        self._anvil.elements.childPanel.style.minHeight = "0px";
                        self._anvil.updatePaginationControls();
                    }),
                    () => {
                        const currentPage = getCurrentPage(self);
                        if (previousPage !== currentPage) {
                            // Release navigation before invoking user code: a handler may navigate again.
                            PyDefUtils.raiseEventAsync(
                                { previous_page: previousPage, current_page: currentPage, source },
                                self,
                                "page_changed"
                            );
                        }
                        return pyNone;
                    }
                );
            };

            const jumpToFirstPage = (self: Paginator) => {
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
                    return pyNone;
                });
            };

            const nextPage = (self: Paginator) => {
                const p =
                    self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1];
                if (p && !p.done && self._anvil.paginatorPages) {
                    self._anvil.pagination = {
                        startAfter: p.stoppedAt,
                        rowQuota: getRowQuota(self),
                    };
                    const newPage: PaginatorPage = {} as PaginatorPage;
                    self._anvil.paginatorPages.push(newPage);
                    return chainOrSuspend(self._anvil.paginate(), ([rows, stoppedAt, done]) => {
                        newPage.startedAfter = p.stoppedAt;
                        newPage.rowsDisplayed = rows;
                        newPage.stoppedAt = stoppedAt;
                        newPage.done = done;
                        newPage.currentPage = p.currentPage + 1;
                        newPage.currentIndex = p.currentIndex + p.rowsDisplayed;
                        return pyNone;
                    });
                }
                return pyNone;
            };

            const jumpToLastPage = (self: Paginator) => {
                return chainOrSuspend(
                    PyDefUtils.whileOrSuspend(
                        () =>
                            !(
                                self._anvil.paginatorPages &&
                                self._anvil.paginatorPages.length > 0 &&
                                self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1].done
                            ),
                        () => nextPage(self)
                    ),
                    () => pyNone
                );
            };

            const previousPage = (self: Paginator) => {
                const p =
                    self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 2];
                if (p && !p.done && self._anvil.paginatorPages) {
                    self._anvil.pagination = {
                        startAfter: p.startedAfter,
                        rowQuota: getRowQuota(self),
                    };
                    self._anvil.paginatorPages.pop();
                    return chainOrSuspend(self._anvil.paginate(), () => pyNone);
                }
                return pyNone;
            };

            const setPage = (self: Paginator, page: any) => {
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
                for (let p = startPage; p < page; p++) {
                    fns.push(() => nextPage(self));
                }

                return chainOrSuspend(null, ...fns, () => pyNone);
            };

            const navigatePage = (
                self: Paginator,
                operation: PageOperation,
                { source, page }: { source: PageChangeSource; page?: any }
            ) => {
                if (operation === "set_page") {
                    page = Sk.misceval.asIndexOrThrow(page);
                    if (page < 0) {
                        throw new pyIndexError("Cannot use a negative index to set the page");
                    }
                }

                return changePage(
                    self,
                    () => {
                        switch (operation) {
                            case "first":
                                return jumpToFirstPage(self);
                            case "previous":
                                return previousPage(self);
                            case "next":
                                return nextPage(self);
                            case "last":
                                return jumpToLastPage(self);
                            case "set_page":
                                return setPage(self, page);
                        }
                    },
                    // First-page resets also run during construction and keep their contents visible.
                    { source, showProgress: operation !== "first" }
                );
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
                self._anvil.navigatePage = (operation, source, page) => navigatePage(self, operation, { source, page });
                self._anvil.recoverInvalidPage = () =>
                    self._anvil.repaginating ? previousPage(self) : changePage(self, () => previousPage(self));
            });

            $loc["jump_to_first_page"] = new pyFunc((self: Paginator) => {
                return self._anvil.navigatePage("first", "code");
            });

            $loc["jump_to_last_page"] = new pyFunc((self: Paginator) => {
                return self._anvil.navigatePage("last", "code");
            });

            $loc["next_page"] = new pyFunc((self: Paginator) => {
                return self._anvil.navigatePage("next", "code");
            });

            $loc["previous_page"] = new pyFunc((self: Paginator) => {
                return self._anvil.navigatePage("previous", "code");
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
                return self._anvil.navigatePage("set_page", "code", page);
            });

            $loc["repaginate"] = new pyFunc((self: Paginator) => {
                const paginatorPages = self._anvil.paginatorPages;
                if (!paginatorPages || paginatorPages.length < 2) {
                    return self._anvil.navigatePage("first", "code");
                }
                return changePage(self, () => {
                    const p = paginatorPages[paginatorPages.length - 1];
                    self._anvil.pagination = {
                        startAfter: p.startedAfter,
                        rowQuota: getRowQuota(self),
                    };
                    self._anvil.lastChildPagination = undefined;
                    return chainOrSuspend(self._anvil.paginate(), ([rows, stoppedAt, done]) => {
                        // Invalid-page recovery has already replaced the current page.
                        if (done !== "INVALID") {
                            paginatorPages.splice(paginatorPages.length - 1, 1, {
                                startedAfter: p.startedAfter,
                                rowsDisplayed: rows,
                                stoppedAt,
                                done,
                                currentPage: p.currentPage,
                                currentIndex: p.currentIndex,
                            });
                        }
                        return pyNone;
                    });
                });
            });
        },
    });
};

export default PaginatorFactory;
