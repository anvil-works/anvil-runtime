interface DateRangePickerOptions {
    timePicker?: boolean;
    timePickerIncrement?: number;
    minDate?: Date | string | null;
    maxDate?: Date | string | null;
    date?: Date | string | null;
    locale?: {
        format?: string;
        applyLabel?: string;
        cancelLabel?: string;
        customRangeLabel?: string;
        daysOfWeek?: string[];
        monthNames?: string[];
        firstDay?: number;
    };
}

interface CalendarData {
    month: Date;
    calendar: Date[][];
    firstDay: Date;
    lastDay: Date;
}

let i = 0;

class DateRangePicker {
    private element: HTMLInputElement;
    private container!: HTMLElement;
    private elements!: Record<string, HTMLElement>;
    private date: Date | null;
    private displayDate: Date;
    private prevDate: Date | null = null;
    private minDate: Date | null = null;
    private maxDate: Date | null = null;
    private options: Required<DateRangePickerOptions>;
    private isShowing = false;
    private calendar: CalendarData = {} as CalendarData;
    private callback: (date: Date | null) => void;

    // Reposition handler used while the picker is visible
    private handleWindowReposition = (): void => {
        if (this.isShowing) this.move();
    };

    // Moment.js helper
    private getMoment(): any {
        const w = window as any;
        return w.moment;
    }

    private updateFormInputs(): void {
        const applyBtn = this.elements?.applyBtn as HTMLButtonElement | undefined;
        if (!applyBtn) return;
        applyBtn.disabled = false;
    }

    private readonly defaultOptions: Required<DateRangePickerOptions> = {
        timePicker: false,
        timePickerIncrement: 1,
        minDate: null,
        maxDate: null,
        date: null,
        locale: {
            format: "MM/DD/YYYY",
            applyLabel: "Apply",
            cancelLabel: "Cancel",
            daysOfWeek: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
            monthNames: [
                "January",
                "February",
                "March",
                "April",
                "May",
                "June",
                "July",
                "August",
                "September",
                "October",
                "November",
                "December",
            ],
            firstDay: 0,
        },
    };

    // Helper method to get moment locale options
    private getMomentLocale(): Partial<DateRangePickerOptions["locale"]> {
        const moment = this.getMoment();
        if (!moment) return {};

        const ld = moment.localeData();
        if (!ld) return {};

        const momentLocale: Partial<DateRangePickerOptions["locale"]> = {};

        // First day of week
        const dow = typeof ld.firstDayOfWeek === "function" ? ld.firstDayOfWeek() : ld._week && ld._week.dow;
        if (typeof dow === "number") {
            momentLocale.firstDay = dow;
        }

        // Weekdays short (Su, Mo, ...)
        const dows = typeof ld.weekdaysMin === "function" ? ld.weekdaysMin() : undefined;
        if (Array.isArray(dows) && dows.length === 7) {
            momentLocale.daysOfWeek = Array.from(dows as string[]);
        }

        // Month names
        const months = typeof ld.months === "function" ? ld.months() : undefined;
        if (Array.isArray(months) && months.length === 12) {
            momentLocale.monthNames = Array.from(months as string[]);
        }

        return momentLocale;
    }

    constructor(
        element: HTMLInputElement,
        options: DateRangePickerOptions = {},
        callback: (date: Date | null) => void
    ) {
        this.element = element;
        this.callback = callback;
        this.options = { ...this.defaultOptions, ...options };

        // Merge locale with proper priority: defaultOptions.locale → momentLocale → options.locale
        this.options.locale = {
            ...this.defaultOptions.locale,
            ...this.getMomentLocale(),
            ...(options.locale ?? {}),
        };

        // Set default dates
        const parsedMin = this.parseDate(this.options.minDate);
        const parsedMax = this.parseDate(this.options.maxDate);
        this.minDate = parsedMin ? this.normalizeConstraint(parsedMin) : null;
        this.maxDate = parsedMax ? this.normalizeConstraint(parsedMax) : null;
        const initialDate = this.parseDate(this.options.date);

        this.date = null;
        this.displayDate = new Date();
        this.setDate(initialDate);

        if (initialDate) {
            this.prevDate = new Date(initialDate);
            this.element.value = this.formatDate(initialDate);
        } else {
            this.prevDate = null;
            this.element.value = "";
        }

        this.show = this.show.bind(this);
        this.toggle = this.toggle.bind(this);
        this.elementChanged = this.elementChanged.bind(this);
        this.inputKeydown = this.inputKeydown.bind(this);

        this.init();
    }

    private formatDate(date: Date): string {
        const moment = this.getMoment();
        if (!moment) return "";
        const fmt = this.options.locale.format;
        return fmt ? moment(date).format(fmt) : moment(date).format((moment as any).ISO_8601);
    }

    private parseDate(dateInput: Date | string | null, validOnly = true): Date | null {
        if (!dateInput) return null;
        if (dateInput instanceof Date) return new Date(dateInput);
        if (typeof dateInput === "string") {
            const moment = this.getMoment();
            if (moment) {
                const fmt = this.options.locale.format;
                const m = fmt
                    ? moment(dateInput, [fmt, (moment as any).ISO_8601], true)
                    : moment(dateInput, (moment as any).ISO_8601, true);
                if (validOnly) {
                    return m && m.isValid() ? m.toDate() : null;
                }
                return m.toDate();
            } else {
                const parsed = new Date(dateInput);
                return validOnly ? (isNaN(parsed.getTime()) ? null : parsed) : parsed;
            }
        }
        return null;
    }

    private init(): void {
        this.createContainer();
        this.bindEvents();
        this.updateView();
    }

    private createContainer(): void {
        const [container, elements] = (
            <div refName="container" className="daterangepicker" role="dialog">
                <div refName="cal" className="drp-calendar left">
                    <div refName="calTable" className="calendar-table"></div>
                    <div refName="calTime" className="calendar-time"></div>
                </div>
                <div refName="buttons" className="drp-buttons">
                    <button refName="cancelBtn" className="cancelBtn btn btn-sm btn-default" type="button">
                        {this.options.locale.cancelLabel}
                    </button>
                    <button refName="applyBtn" className="applyBtn btn btn-sm btn-primary" type="button">
                        {this.options.locale.applyLabel}
                    </button>
                </div>
            </div>
        );

        this.elements = elements as Record<string, HTMLElement>;
        this.container = container as HTMLElement;

        if (!this.options.timePicker) {
            this.elements.buttons.style.display = "none";
        }
        this.container.style.display = "none";

        document.body.appendChild(this.container);
    }

    // Ranges UI not used

    private bindEvents(): void {
        // Calendar navigation events
        this.container.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;

            if (target.closest(".prev")) {
                this.clickPrev(e);
            } else if (target.closest(".next")) {
                this.clickNext(e);
            } else if (target.closest(".applyBtn")) {
                this.clickApply();
            } else if (target.closest(".cancelBtn")) {
                this.clickCancel();
            }
        });

        this.container.addEventListener("mousedown", (e) => {
            // because the css is a bit nicer when you do it on the mouse down
            const target = e.target as HTMLElement;
            if (target.closest("td.available")) {
                this.clickDate(e);
            }
        });

        // Keyboard events within the container (for Enter/Escape when focus is inside)
        this.container.addEventListener("keydown", (e) => this.keydown(e as KeyboardEvent), true);

        // Dropdown change events
        this.container.addEventListener("change", (e) => {
            const target = e.target as HTMLElement;
            if (target.matches(".monthselect, .yearselect")) {
                this.monthOrYearChanged(e);
            } else if (target.matches(".hourselect, .minuteselect")) {
                this.timeChanged(e);
            }
        });
        this.bindInputEvents();
    }

    private bindInputEvents() {
        if (this.element.tagName === "INPUT" || this.element.tagName === "BUTTON") {
            this.element.addEventListener("click", this.show);
            this.element.addEventListener("focus", this.show);
            this.element.addEventListener("keyup", this.elementChanged);
            this.element.addEventListener("keydown", this.inputKeydown);
            this.element.addEventListener("change", this.elementChanged);
        } else {
            this.element.addEventListener("click", this.toggle);
            this.element.addEventListener("keydown", this.inputKeydown);
        }
    }

    private unbindInputEvents(): void {
        if (this.element.tagName === "INPUT" || this.element.tagName === "BUTTON") {
            this.element.removeEventListener("click", this.show);
            this.element.removeEventListener("focus", this.show);
            this.element.removeEventListener("keyup", this.elementChanged);
            this.element.removeEventListener("keydown", this.inputKeydown);
            this.element.removeEventListener("change", this.elementChanged);
        } else {
            this.element.removeEventListener("click", this.toggle);
            this.element.removeEventListener("keydown", this.inputKeydown);
        }
    }

    private clickPrev(e: Event): void {
        this.calendar.month.setMonth(this.calendar.month.getMonth() - 1);
        this.updateCalendars();
    }

    private clickNext(e: Event): void {
        this.calendar.month.setMonth(this.calendar.month.getMonth() + 1);
        this.updateCalendars();
    }

    private clickDate(e: Event): void {
        const td = (e.target as HTMLElement).closest("td") as HTMLTableCellElement;
        if (!td?.classList.contains("available")) return;

        const title = td.getAttribute("data-title");
        if (!title) return;

        const row = parseInt(title.substring(1, 2));
        const col = parseInt(title.substring(3, 4));
        const date = this.calendar.calendar[row][col];

        if (this.options.timePicker) this.applyTimeToDate(date);
        this.setDate(date);
        if (!this.options.timePicker) {
            this.clickApply();
        } else {
            this.element.value = this.formatDate(date);
        }

        this.updateView();

        // Ensure container has focus so keyboard handlers work
        setTimeout(() => {
            try {
                this.container.tabIndex = 0;
                this.container.focus({ preventScroll: true });
                this.container.tabIndex = -1;
            } catch {}
        });

        e.stopPropagation();
    }

    private applyTimeToDate(date: Date): void {
        const container = this.elements.cal;
        const hourSelect = container?.querySelector(".hourselect") as HTMLSelectElement;
        const minuteSelect = container?.querySelector(".minuteselect") as HTMLSelectElement;

        if (hourSelect && minuteSelect) {
            const hour = parseInt(hourSelect.value, 10);
            const minute = parseInt(minuteSelect.value, 10) || 0;
            const second = 0;
            date.setHours(hour, minute, second, 0);
        }
    }

    // Range selection not supported in this simplified build

    private clickApply(forceDate?: Date | null, fromChange?: boolean): void {
        if (!fromChange) {
            this.hide();
        }
        // should only do this on clickApply?
        if (forceDate === undefined) {
            forceDate = this.date;
        }

        this.element.value = forceDate ? this.formatDate(forceDate) : "";
        if (this.prevDate?.getTime() === forceDate?.getTime()) return;
        this.prevDate = forceDate ? new Date(forceDate) : null;
        this.callback(forceDate);
    }

    private clickCancel(): void {
        // Restore previous selection and close without applying or updating the input
        this.setDate(this.prevDate);

        // Manually hide without triggering callback/updateElement
        if (this.prevDate) {
            this.element.value = this.formatDate(this.prevDate);
        } else {
            this.element.value = "";
        }
        if (!this.isShowing) return;
        this.container.style.display = "none";
        this.isShowing = false;
        this.removeGlobalListeners();
    }

    private monthOrYearChanged(e: Event): void {
        const select = e.target as HTMLSelectElement;
        const current = this.calendar.month;
        let month = current.getMonth();
        let year = current.getFullYear();

        if (select.classList.contains("monthselect")) {
            month = parseInt(select.value, 10);
        } else if (select.classList.contains("yearselect")) {
            year = parseInt(select.value, 10);
        }

        this.calendar.month.setFullYear(year, month);
        this.updateCalendars();
    }

    private timeChanged(e: Event): void {
        const cal = this.elements.cal;
        const hourSelect = cal?.querySelector(".hourselect") as HTMLSelectElement;
        const minuteSelect = cal?.querySelector(".minuteselect") as HTMLSelectElement;
        if (!hourSelect || !minuteSelect) return;

        const hour = parseInt(hourSelect.value, 10);
        const minute = parseInt(minuteSelect.value, 10) || 0;
        const second = 0;

        const base = new Date(this.displayDate);
        const start = new Date(base);
        start.setHours(hour, minute, second, 0);
        this.setDate(start);

        this.updateCalendars();
        this.updateFormInputs();
        this.renderTimePicker();

        if (!this.options.timePicker) {
            this.clickApply();
        } else {
            this.element.value = this.formatDate(start);
        }
    }

    private elementChanged(e: Event): void {
        if (this.element.tagName !== "INPUT") return;

        const input = this.element as HTMLInputElement;
        const value = input.value.trim();

        let parsed = this.parseDate(value, false);
        let submitDate;
        if (parsed && isNaN(parsed.getTime())) {
            // invalid date
            submitDate = this.prevDate;
            this.setDate(this.prevDate);
        } else if (parsed) {
            const normalized = this.setDate(parsed);
            submitDate = normalized ?? this.prevDate;
            this.updateView();
        } else {
            submitDate = null;
            this.setDate(null);
        }

        if (e.type === "change") {
            this.clickApply(submitDate, true);
        }
    }

    private inputKeydown(e: KeyboardEvent) {
        switch (e.key) {
            case "Enter":
            case "Tab":
                // TODO - decide on the right behaviour here
                this.hide();
                break;
            case "Escape":
                this.clickCancel();
                break;
        }
    }

    private keydown(e: KeyboardEvent): void {
        switch (e.key) {
            case "Enter":
                e.preventDefault();
                e.stopPropagation();
                this.clickApply();
                break;
            case "Escape":
                e.preventDefault();
                e.stopPropagation();
                this.clickCancel();
                break;
        }
    }

    // Public API methods
    public show(): void {
        if (this.isShowing) return;
        this.isShowing = true;

        if (!this.date) {
            this.displayDate = this.normalizeDate(new Date());
            if (this.options.timePicker) {
                this.displayDate.setHours(0, 0, 0, 0);
            }
        }

        this.updateView();
        this.container.style.display = "block";
        this.move();
        this.addGlobalListeners();
    }

    public hide(): void {
        if (!this.isShowing) return;
        this.isShowing = false;

        this.container.style.display = "none";
        this.removeGlobalListeners();
    }

    public toggle(): void {
        if (this.isShowing) {
            this.hide();
        } else {
            this.show();
        }
    }

    public setDate(date: Date | null): Date | null {
        if (date) {
            const normalized = this.normalizeDate(date);
            this.date = normalized;
            this.displayDate = normalized;
        } else {
            this.date = null;
            this.displayDate = this.normalizeDate(new Date());
            if (this.options.timePicker) {
                this.displayDate.setHours(0, 0, 0, 0);
            }
        }

        this.updateMonthsInView();
        return this.date;
    }

    private outsideClickHandler = (e: MouseEvent): void => {
        const target = e.target as HTMLElement;
        if (
            target.closest(this.element.tagName) === this.element ||
            target.closest(".daterangepicker") === this.container ||
            target.closest(".calendar-table")
        ) {
            return;
        }
        if (this.isShowing) {
            this.clickApply();
        }
    };

    private move(): void {
        // Position the dropdown relative to the element
        const rect = this.element.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();

        let top = rect.bottom + window.scrollY;
        let left = rect.left + window.scrollX;

        // Auto drops positioning only (internal use always sets drops: 'auto')
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        if (spaceBelow < containerRect.height && spaceAbove > containerRect.height) {
            top = rect.top + window.scrollY - containerRect.height;
            this.container.classList.add("drop-up");
        } else {
            this.container.classList.remove("drop-up");
        }

        // Keep within viewport
        if (left < 0) left = 9;
        if (left + containerRect.width > window.innerWidth) {
            left = window.innerWidth - containerRect.width;
        }

        this.container.style.top = `${top}px`;
        this.container.style.left = `${left}px`;
    }

    private updateView(): void {
        if (this.options.timePicker) {
            this.renderTimePicker();
        }

        this.updateMonthsInView();
        this.updateCalendars();
        this.updateFormInputs();
    }

    private updateMonthsInView(): void {
        const reference = this.displayDate;
        const month = new Date(reference);
        month.setDate(2);
        this.calendar.month = month;
    }

    private updateCalendars(): void {
        this.renderCalendar();
    }

    private renderCalendar(): void {
        const calendar = this.calendar;
        const month = calendar.month.getMonth();
        const year = calendar.month.getFullYear();
        const hour = calendar.month.getHours();
        const minute = calendar.month.getMinutes();
        const second = calendar.month.getSeconds();

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month, daysInMonth);
        const lastMonth = month === 0 ? 11 : month - 1;
        const lastYear = month === 0 ? year - 1 : year;
        const daysInLastMonth = new Date(lastYear, lastMonth + 1, 0).getDate();
        const dayOfWeek = firstDay.getDay();

        // Build calendar matrix
        const calendarArray: Date[][] = [];
        for (let i = 0; i < 6; i++) {
            calendarArray[i] = [];
        }

        const firstDayOfWeek = this.options.locale.firstDay ?? 0;
        let startDay = daysInLastMonth - dayOfWeek + firstDayOfWeek + 1;
        if (startDay > daysInLastMonth) startDay -= 7;
        if (dayOfWeek === firstDayOfWeek) startDay = daysInLastMonth - 6;

        let curDate = new Date(lastYear, lastMonth, startDay, 12, minute, second);

        for (let i = 0, col = 0, row = 0; i < 42; i++, col++) {
            if (i > 0 && col % 7 === 0) {
                col = 0;
                row++;
            }
            calendarArray[row][col] = new Date(curDate);
            calendarArray[row][col].setHours(hour, minute, second, 0);
            curDate.setDate(curDate.getDate() + 1);
            curDate.setHours(12);

            // Adjust for min/max dates
            if (
                this.minDate &&
                this.isSameDay(calendarArray[row][col], this.minDate) &&
                calendarArray[row][col] < this.minDate
            ) {
                calendarArray[row][col] = new Date(this.minDate);
            }

            if (
                this.maxDate &&
                this.isSameDay(calendarArray[row][col], this.maxDate) &&
                calendarArray[row][col] > this.maxDate
            ) {
                calendarArray[row][col] = new Date(this.maxDate);
            }
        }

        calendar.calendar = calendarArray;
        calendar.firstDay = firstDay;
        calendar.lastDay = lastDay;

        // Render HTML
        this.renderCalendarHtml(calendar);
    }

    private renderCalendarHtml(calendar: CalendarData): void {
        const minDate = this.minDate;
        const maxDate = this.maxDate;

        // Header controls
        const currentMonth = calendar.month.getMonth();
        const currentYear = calendar.month.getFullYear();
        const maxYear = (maxDate && maxDate.getFullYear()) || currentYear + 10;
        const minYear = (minDate && minDate.getFullYear()) || currentYear - 10;

        const prevCell =
            !minDate || minDate < calendar.firstDay
                ? '<th class="prev available" aria-label="Previous month"><span aria-hidden="true"></span></th>'
                : "<th></th>";

        const nextCell =
            !maxDate || maxDate > calendar.lastDay
                ? '<th class="next available" aria-label="Next month"><span aria-hidden="true"></span></th>'
                : "<th></th>";

        const isMonthDisabled = (m: number) =>
            (minDate &&
                (currentYear < minDate.getFullYear() ||
                    (currentYear === minDate.getFullYear() && m < minDate.getMonth()))) ||
            (maxDate &&
                (currentYear > maxDate.getFullYear() ||
                    (currentYear === maxDate.getFullYear() && m > maxDate.getMonth())));

        const monthOptions = Array.from({ length: 12 }, (_, m) => {
            const monthName = (this.options.locale.monthNames && this.options.locale.monthNames[m]) ?? String(m);
            const selected = m === currentMonth ? "selected" : "";
            const disabled = isMonthDisabled(m) ? "disabled" : "";
            return `<option value="${m}" ${selected} ${disabled}>${monthName}</option>`;
        });

        const yearOptions = Array.from({ length: maxYear - minYear + 1 }, (_, i) => {
            const y = minYear + i;
            const selected = y === currentYear ? "selected" : "";
            return `<option value="${y}" ${selected}>${y}</option>`;
        });

        const dowList = this.options.locale.daysOfWeek ?? [];
        // Rotate the days of week array to match firstDayOfWeek setting
        const fDow = this.options.locale.firstDay ?? 0;
        const rotatedDowList = fDow === 0 ? dowList : [...dowList.slice(fDow), ...dowList.slice(0, fDow)];
        const daysHead = rotatedDowList.map((day) => `<th role="columnheader" scope="col">${day}</th>`).join("");

        // Body rows
        const bodyRows: string[][] = [];
        for (let row = 0; row < 6; row++) {
            const cells: string[] = [];
            for (let col = 0; col < 7; col++) {
                const date = calendar.calendar[row][col];
                const classes = this.getDateClasses(date, calendar.month, minDate, maxDate);
                if (!classes.includes("disabled")) classes.push("available");
                const isDisabled = classes.includes("disabled");
                const isActive = classes.includes("active");
                const isToday = classes.includes("today");
                const ariaSelected = ` aria-selected="${isActive ? "true" : "false"}"`;
                const ariaDisabled = isDisabled ? ' aria-disabled="true"' : "";
                const ariaCurrent = isToday ? ' aria-current="date"' : "";
                const ariaLabel = ` aria-label="${date.toDateString()}"`;
                cells.push(
                    `<td role="gridcell" class="${classes.join(
                        " "
                    )}" data-title="r${row}c${col}"${ariaSelected}${ariaDisabled}${ariaCurrent}${ariaLabel}>${date.getDate()}</td>`
                );
            }
            bodyRows.push(cells);
        }

        const monthSelect = `<select class="monthselect" aria-label="Select month">${monthOptions.join("")}</select>`;
        const yearSelect = `<select class="yearselect" aria-label="Select year">${yearOptions.join("")}</select>`;

        this.elements.calTable.innerHTML = `
<table class="table-condensed" role="grid">
  <thead>
    <tr>
      ${prevCell}
      <th colspan="5" class="month">
        ${monthSelect}
        ${yearSelect}
      </th>
      ${nextCell}
    </tr>
    <tr>
      ${daysHead}
    </tr>
  </thead>
  <tbody>
    ${bodyRows.map((row) => `<tr role="row">${row.join("")}</tr>`).join("\n    ")}
  </tbody>
</table>`;
    }

    private getDateClasses(date: Date, calendarMonth: Date, minDate: Date | null, maxDate: Date | null): string[] {
        const classes: string[] = [];

        // Today
        if (this.isSameDay(date, new Date())) {
            classes.push("today");
        }

        // Weekend
        if (date.getDay() === 0 || date.getDay() === 6) {
            classes.push("weekend");
        }

        // Other month
        if (date.getMonth() !== calendarMonth.getMonth()) {
            classes.push("off", "ends");
        }

        // Disabled dates
        if (minDate && date < minDate) {
            classes.push("off", "disabled");
        }

        if (maxDate && date > maxDate) {
            classes.push("off", "disabled");
        }

        // Selected dates
        if (this.displayDate && this.isSameDay(date, this.displayDate)) {
            classes.push("active", "start-date", "end-date");
        }

        return classes;
    }

    private renderTimePicker(): void {
        const selected = this.displayDate;
        const minDate = this.minDate;
        const maxDate = this.maxDate;

        // Hours (24-hour)
        let html = '<select class="hourselect">';
        for (let i = 0; i <= 23; i++) {
            const time = new Date(selected);
            time.setHours(i);
            time.setMinutes(
                Math.floor(selected.getMinutes() / (this.options.timePickerIncrement || 1)) *
                    (this.options.timePickerIncrement || 1)
            );
            time.setSeconds(0);
            const disabled = (minDate && time < minDate) || (maxDate && time > maxDate);
            const padded = i.toString().padStart(2, "0");
            html += `<option value="${i}" ${disabled ? 'disabled class="disabled"' : ""} ${
                i === selected.getHours() ? "selected" : ""
            }>${padded}</option>`;
        }
        html += "</select> ";

        // Minutes
        html += '<select class="minuteselect">';
        const increment = this.options.timePickerIncrement || 1;
        for (let i = 0; i < 60; i += increment) {
            const padded = i.toString().padStart(2, "0");
            const time = new Date(selected);
            time.setMinutes(i);
            time.setSeconds(0);
            const disabled = (minDate && time < minDate) || (maxDate && time > maxDate);
            html += `<option value="${i}" ${disabled ? 'disabled class="disabled"' : ""} ${
                i === selected.getMinutes() ? "selected" : ""
            }>${padded}</option>`;
        }
        html += "</select>";

        const timeContainer = this.elements.calTime as HTMLElement;
        if (timeContainer) {
            timeContainer.innerHTML = html;
        }
    }

    private normalizeConstraint(date: Date): Date {
        const normalized = new Date(date);
        if (!this.options.timePicker) {
            normalized.setHours(0, 0, 0, 0);
        } else {
            normalized.setMilliseconds(0);
        }
        return normalized;
    }

    private normalizeDate(date: Date): Date {
        const normalized = this.normalizeConstraint(date);
        if (this.minDate && normalized < this.minDate) {
            return new Date(this.minDate);
        }

        if (this.maxDate && normalized > this.maxDate) {
            return new Date(this.maxDate);
        }

        return normalized;
    }

    private isSameDay(date1: Date, date2: Date): boolean {
        return (
            date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate()
        );
    }

    private addGlobalListeners(): void {
        // Add outside click handler
        setTimeout(() => {
            document.addEventListener("mousedown", this.outsideClickHandler);
        }, 0);

        // Reposition on window changes (resize/scroll/orientation)
        window.addEventListener("resize", this.handleWindowReposition);
        window.addEventListener("scroll", this.handleWindowReposition, true);
        window.addEventListener("orientationchange", this.handleWindowReposition as any);
    }

    private removeGlobalListeners(): void {
        document.removeEventListener("mousedown", this.outsideClickHandler);
        window.removeEventListener("resize", this.handleWindowReposition);
        window.removeEventListener("scroll", this.handleWindowReposition, true);
        window.removeEventListener("orientationchange", this.handleWindowReposition as any);
    }

    public remove(): void {
        this.removeGlobalListeners();
        this.unbindInputEvents();
        this.container.remove();
        this.isShowing = false;
    }
}

export default DateRangePicker;
