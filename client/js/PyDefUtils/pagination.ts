import type { Suspension } from "@Sk";
import { chainOrSuspend, iterArray } from "@Sk";

export let logPagination = false;

type PaginationDone = boolean | "INVALID";
type PaginationResult = [rows: number, stoppedAt: unknown, done: PaginationDone];
type ResumePoint = [idx: number, value: unknown, done: PaginationDone];

interface PaginatedChild {
    component: {
        _anvil?: {
            paginate?: () => unknown;
            pagination?: {
                startAfter: unknown;
                rowQuota: number;
            };
        };
    };
    layoutProperties: {
        pinned?: boolean;
    };
}

export const setLogPagination = (value: boolean) => {
    logPagination = value;
};

export const repaginateChildren = (
    self: any,
    skip: number,
    startAfter: ResumePoint | null,
    remainingRowQuota: number
): PaginationResult | Suspension => {
    if (logPagination) console.log("Repaginate children starting from", startAfter, "with quota", remainingRowQuota);

    let startAfterIdx: number | null = null;
    let startAfterValue: unknown = null;
    let startAfterDone: PaginationDone = false;
    if (startAfter) {
        [startAfterIdx, startAfterValue, startAfterDone] = startAfter;
    }

    let passedResumePoint = startAfter == null;
    let pyComponents: PaginatedChild[] = [...self._anvil.components];
    self._anvil.lastChildPagination = self._anvil.lastChildPagination || new Array(pyComponents.length);
    const lastChildPagination = self._anvil.lastChildPagination as Array<PaginationResult | undefined>;

    // Iterate through my components, asking them to paginate in turn until we run out of rows.
    return chainOrSuspend(
        undefined,
        () =>
            iterArray(
                pyComponents,
                ({ component, layoutProperties }, idx) => {
                    if (layoutProperties.pinned && component._anvil?.paginate) {
                        component._anvil.pagination = {
                            startAfter: null,
                            rowQuota: remainingRowQuota,
                        };
                        return chainOrSuspend(
                            component._anvil.paginate(),
                            ([rows, ,]: PaginationResult) => {
                                lastChildPagination[idx] = undefined;
                                remainingRowQuota -= rows;
                            },
                            () => idx + 1
                        );
                    }
                    return idx + 1;
                },
                /* idx = */ 0
            ),
        () =>
            iterArray(
                pyComponents,
                ({ component, layoutProperties }, idx) => {
                    // We only care about this component if it's a ClassicComponet with a paginate function.
                    if (!layoutProperties.pinned && component._anvil?.paginate) {
                        // We need to display this child if we're either past the resume point or if the resume
                        // point *is* this child and it wasn't done.

                        let atResumePoint = !!startAfter && idx === startAfterIdx;

                        if (idx < skip) {
                            return idx + 1;
                        }

                        if (passedResumePoint || (atResumePoint && !startAfterDone)) {
                            // If our start point is this child, pass on state so that *it* can resume from the correct point.
                            let startAfterThisComponent = !!startAfter && startAfter[0] === idx;

                            component._anvil.pagination = {
                                startAfter: startAfterThisComponent ? startAfter![1] : null,
                                rowQuota: remainingRowQuota,
                            };
                            return chainOrSuspend(
                                component._anvil.paginate(),
                                ([rows, stoppedAt, done]: PaginationResult) => {
                                    lastChildPagination[idx] = [rows, stoppedAt, done];
                                    if (rows > 0) {
                                        remainingRowQuota -= rows;
                                    }
                                    passedResumePoint = true;
                                },
                                () => idx + 1
                            );
                        } else {
                            component._anvil.pagination = {
                                startAfter: null,
                                rowQuota: 0,
                            };
                            return chainOrSuspend(
                                component._anvil.paginate(),
                                () => {
                                    lastChildPagination[idx] = undefined;
                                    passedResumePoint = passedResumePoint || atResumePoint;
                                },
                                () => idx + 1
                            );
                        }
                    }
                    return idx + 1;
                },
                /* idx = */ 0
            ),
        () => {
            // The total number of rows is just the sum of all the rows displayed by children.
            let rows = lastChildPagination.reduce<number>((sum, child) => sum + (child ? child[0] : 0), 0);
            // We stopped at the last child who displayed any rows.
            let stoppedAt = lastChildPagination.reduce<ResumePoint | null>(
                (stoppedAt, child, idx) => (child && child[0] ? [idx, child[1], child[2]] : stoppedAt),
                null
            );
            // We're done if all children are done
            let done: PaginationDone = true;
            for (let child of lastChildPagination) {
                if (child && child[2] === false) {
                    done = false;
                } else if (child && child[2] === "INVALID") {
                    done = "INVALID";
                    break;
                }
            }

            if (logPagination)
                console.log("Children displayed", rows, "rows.", done ? "Done" : "Interrupted", "at", stoppedAt);
            return [rows, stoppedAt, done];
            // Done iterating through my components
        }
    );
};
