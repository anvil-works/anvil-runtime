interface OrderedSlotDef {
    index?: number;
    slot_order?: number;
}

type NamedSlotDef<T extends OrderedSlotDef> = readonly [name: string, slot: T];

export const compareNamedSlotDefs = <T extends OrderedSlotDef>(
    [nameA, slotA]: NamedSlotDef<T>,
    [nameB, slotB]: NamedSlotDef<T>
) => {
    const indexDiff = (slotA.index ?? 0) - (slotB.index ?? 0);
    if (indexDiff !== 0) {
        return indexDiff;
    }

    const slotOrderA = slotA.slot_order;
    const slotOrderB = slotB.slot_order;
    if (typeof slotOrderA === "number") {
        if (typeof slotOrderB !== "number") {
            return -1;
        }
        const slotOrderDiff = slotOrderA - slotOrderB;
        if (slotOrderDiff !== 0) {
            return slotOrderDiff;
        }
    } else if (typeof slotOrderB === "number") {
        return 1;
    }
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
};
