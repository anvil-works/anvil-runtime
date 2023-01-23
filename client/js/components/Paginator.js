"use strict";

var PyDefUtils = require("PyDefUtils");


module.exports = (pyModule) => {
    pyModule["Paginator"] = PyDefUtils.mkComponentCls(pyModule, "Paginator", {
        base: pyModule["ClassicContainer"],

        locals($loc) {
            // TODO: Add .anvil-paginator to component element here rather than in each component.

            let getRowQuota = self => {
                let rows = self._anvil && self._anvil.getPropJS && self._anvil.getPropJS("rows_per_page");
                if (rows && rows > 0) {
                    return rows;
                } else {
                    return Infinity;
                }
            };

            let setRepaginating = (self, repaginating, ignoreHeight) => {
                self._anvil.repaginating = repaginating;
                if (ignoreHeight) {
                    self._anvil.ignoreHeight = true;
                } else if (ignoreHeight === undefined && self._anvil.ignoreHeight) {
                    return;
                } else {
                    self._anvil.ignoreHeight = false;
                }
                if (repaginating) {
                    self._anvil.elements.childPanel.style.minHeight = self._anvil.elements.childPanel.clientHeight + "px";
                    self._anvil.domNode.classList.add("paginating");
                } else {
                    self._anvil.domNode.classList.remove("paginating");
                    self._anvil.elements.childPanel.style.minHeight = "0px";
                }
            }

            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicContainer"], (self) => {
                self._anvil.pagination = {
                    startAfter: null,
                    rowQuota: getRowQuota(self),
                };
    
                self._anvil.updatePaginationControls = () => {
                    const disablePrev = !self._anvil.paginatorPages || self._anvil.paginatorPages.length < 2;
                    self._anvil.elements.firstPage.classList.toggle("disabled", disablePrev);
                    self._anvil.elements.prevPage.classList.toggle("disabled", disablePrev);
                    const disableNext = self._anvil.pagination.done === true;
                    self._anvil.elements.nextPage.classList.toggle("disabled", disableNext);
                    self._anvil.elements.lastPage.classList.toggle("disabled", disableNext);
                };
            });
    
            $loc["jump_to_first_page"] = new Sk.builtin.func(self => {
                if (self._anvil.repaginating) {
                    return Sk.builtin.none.none$;
                }

                self._anvil.ignoreHeight = true;
                setRepaginating(self, true);
                self._anvil.pagination = {
                    startAfter: null,
                    rowQuota: getRowQuota(self)
                }
                delete self._anvil.lastChildPagination;
                return Sk.misceval.chain(self._anvil.paginate(),
                    ([rows, stoppedAt, done]) => {
                        self._anvil.paginatorPages = [{
                            startedAfter: null,
                            stoppedAt: stoppedAt,
                            done: done,
                            rowsDisplayed: rows,
                            currentPage: 0,
                            currentIndex: 0,
                        }];
                        self._anvil.updatePaginationControls();
                        setRepaginating(self, false, false);
                        return Sk.builtin.none.none$;
                    }
                );
            });
    
            $loc["jump_to_last_page"] = new Sk.builtin.func(self => {
                if (self._anvil.repaginating) {
                    return Sk.builtin.none.none$;
                }

                setRepaginating(self, true, true);
                return Sk.misceval.chain(PyDefUtils.whileOrSuspend(
                        () => !(self._anvil.paginatorPages && self._anvil.paginatorPages.length > 0 && self._anvil.paginatorPages[self._anvil.paginatorPages.length-1].done), 
                        () => Sk.misceval.chain(undefined,
                            () => { setRepaginating(self, false); },
                            () => Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str("next_page"))),
                            () => { setRepaginating(self, true); },
                        ),
                    ),
                    () => {
                        setRepaginating(self, false, false);
                        return Sk.builtin.none.none$
                    },
                );
            });
            
            $loc["next_page"] = new Sk.builtin.func(self => {
                if (self._anvil.repaginating) {
                    return Sk.builtin.none.none$;
                }

                let p = self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1];
                if (p && !p.done) {
                    setRepaginating(self, true);
                    self._anvil.pagination = {
                        startAfter: p.stoppedAt,
                        rowQuota: getRowQuota(self),
                    }
                    let newPage = {};
                    self._anvil.paginatorPages.push(newPage);
                    return Sk.misceval.chain(self._anvil.paginate(),
                        ([rows, stoppedAt, done]) => {
    
                            newPage.startedAfter = p.stoppedAt;
                            newPage.rowsDisplayed = rows;
                            newPage.stoppedAt = stoppedAt;
                            newPage.done = done;
                            newPage.currentPage = p.currentPage + 1;
                            newPage.currentIndex = p.currentIndex + rows;
    
                            setRepaginating(self, false);
                            self._anvil.updatePaginationControls();
                            return Sk.builtin.none.none$;
                        }
                    );
                }
            });
    
            $loc["previous_page"] = new Sk.builtin.func(self => {
                if (self._anvil.repaginating) {
                    return Sk.builtin.none.none$;
                }
                let p = self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 2];
                if (p && !p.done) {
                    setRepaginating(self, true);
                    self._anvil.pagination = {
                        startAfter: p.startedAfter,
                        rowQuota: getRowQuota(self),
                    }
                    self._anvil.paginatorPages.pop();
                    return Sk.misceval.chain(self._anvil.paginate(),
                        ([rows, stoppedAt, done]) => {
                            setRepaginating(self, false);
                            self._anvil.updatePaginationControls();
                            return Sk.builtin.none.none$;
                        }
                    );
                }
            });
    
            $loc["get_page"] = new Sk.builtin.func(self => {
                let p = self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1];
                if (p) {
                    return Sk.ffi.remapToPy(p.currentPage);
                }
                return Sk.builtin.none.none$;
            });
    
            $loc["get_first_index_on_page"] = new Sk.builtin.func(self => {
                let p = self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1];
                if (p) {
                    return Sk.ffi.remapToPy(p.currentIndex);
                }
                return Sk.builtin.none.none$;
            });
    
            $loc["set_page"] = new Sk.builtin.func((self, page) => {
                page = Sk.misceval.asIndexOrThrow(page);
                if (page < 0) {
                    throw new Sk.builtin.IndexError("Cannot use a negative index to set the page");
                }
    
                const closestPageBefore =
                    self._anvil.paginatorPages &&
                    self._anvil.paginatorPages[Math.min(page, self._anvil.paginatorPages.length - 1)];
                const fns = [];
                let startPage = 0;
                if (closestPageBefore != null) {
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
                const nextPageMeth = self.tp$getattr(new Sk.builtin.str("next_page"));
                for (let p = startPage; p < page; p++) {
                    fns.push(() => Sk.misceval.callsimOrSuspend(nextPageMeth));
                }

                return Sk.misceval.chain(null, ...fns, () => Sk.builtin.none.none$);
            });
    
            $loc["repaginate"] = new Sk.builtin.func(self => {
                if (self._anvil.paginatorPages && self._anvil.paginatorPages.length > 1) {
                    if (self._anvil.repaginating) 
                        return Sk.builtin.none.none$;
                    let p = self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1];
                    if (p) {
                        setRepaginating(self, true);
                        self._anvil.pagination = {
                            startAfter: p.startedAfter,
                            rowQuota: getRowQuota(self),
                        }
                        self._anvil.lastChildPagination = undefined;
                        return Sk.misceval.chain(self._anvil.paginate(),
                            ([rows, stoppedAt, done]) => {
                                self._anvil.paginatorPages.splice(self._anvil.paginatorPages.length - 1, 1, {
                                    startedAfter: p.startedAfter,
                                    rowsDisplayed: rows,
                                    stoppedAt: stoppedAt,
                                    done: done,
                                    currentPage: p.currentPage,
                                    currentIndex: p.currentIndex,
                                });
                                setRepaginating(self, false);
                                self._anvil.updatePaginationControls();
                                return Sk.builtin.none.none$;
                            }
                        );
                    }
    
                } else {
                    return Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str("jump_to_first_page")));
                }
            });
        }
    });
}
