/**
 * Modern notification system
 * Replaces bootstrap-notify with vanilla JavaScript
 */

import { BOOTSTRAP_MODAL_BG } from "./modal";
import { getCssPrefix } from "@runtime/runner/legacy-features";

interface NotifyContent {
    message: string;
    title?: string;
}

interface NotifyOptions {
    type?: string;
    timeout?: number; // timeout in milliseconds
    placement?: {
        from: string;
        align: string;
    };
    onClosed?: () => void;
}

class Notify {
    private element!: HTMLElement;
    private elements!: Record<string, HTMLElement>;
    private options: NotifyOptions;
    private timer?: number;
    private isHovered = false;
    private remainingTime: number;

    constructor(content: NotifyContent | string, options: NotifyOptions = {}) {
        const normalizedContent = typeof content === "string" ? { message: content, title: "" } : content;

        this.options = {
            type: "info",
            timeout: 2000,
            placement: { from: "top", align: "right" },
            ...options,
        };

        this.remainingTime = this.options.timeout || 2000;
        this.createElement(normalizedContent);
        this.setupEventListeners();
        this.show();
    }

    private createElement(content: NotifyContent) {
        // Get CSS prefix for runtime version >= 3 to prefix bootstrap classes
        const prefix = getCssPrefix();

        const baseStyle = `position: fixed; z-index: ${BOOTSTRAP_MODAL_BG}; display: inline-block; margin: 0px auto; transition: all 0.5s ease-in-out;`;

        const [element, elements] = (
            <div>
                <div
                    refName="container"
                    data-notify="container"
                    className={`${prefix}col-xs-11 ${prefix}col-sm-4 ${prefix}alert ${prefix}alert-${this.options.type} ${prefix}animated`}
                    style={baseStyle}
                    role="alert">
                    <button
                        refName="closeButton"
                        type="button"
                        aria-hidden="true"
                        className={`${prefix}close`}
                        data-notify="dismiss">
                        &times;
                    </button>
                    <span data-notify="icon"></span>
                    <span data-notify="title">{content.title || ""}</span>
                    <span data-notify="message">{content.message}</span>
                </div>
            </div>
        );

        this.element = element as HTMLElement;
        this.elements = elements as Record<string, HTMLElement>;

        this.applyStyles();
    }

    private applyStyles() {
        this.positionElement();
        const prefix = getCssPrefix();
        this.elements.container.classList.add(`${prefix}fadeInDown`);
    }

    private positionElement() {
        const { placement } = this.options;
        const offset = 20;
        const spacing = 10;

        let offsetAmount = offset;
        const existingNotifications = document.querySelectorAll(
            `[data-notify-position="${placement!.from}-${placement!.align}"]:not([data-closing="true"])`
        );

        existingNotifications.forEach((el) => {
            const rect = (el as HTMLElement).getBoundingClientRect();
            const currentOffset = parseInt((el as HTMLElement).style[placement!.from as any] || "0", 10);
            offsetAmount = Math.max(offsetAmount, currentOffset + rect.height + spacing);
        });

        const container = this.elements.container;
        container.style[placement!.from as any] = `${offsetAmount}px`;

        switch (placement!.align) {
            case "left":
            case "right":
                container.style[placement!.align as any] = `${offset}px`;
                break;
            case "center":
                container.style.left = "0";
                container.style.right = "0";
                break;
        }

        container.setAttribute("data-notify-position", `${placement!.from}-${placement!.align}`);
    }

    private setupEventListeners() {
        this.elements.closeButton.addEventListener("click", () => this.close());

        this.elements.container.addEventListener("mouseenter", () => {
            this.isHovered = true;
        });

        this.elements.container.addEventListener("mouseleave", () => {
            this.isHovered = false;
        });
    }

    private show() {
        document.body.appendChild(this.element);

        // Start auto-close timer if timeout is set
        if (this.options.timeout && this.options.timeout > 0) {
            this.startTimer();
        }
    }

    private startTimer() {
        const timeout = this.options.timeout!;
        const timerInterval = timeout === 0 ? 0 : 10; // If timeout is 0, don't auto-close

        if (timerInterval <= 0) return;

        this.timer = window.setInterval(() => {
            if (!this.isHovered) {
                this.remainingTime -= timerInterval;
            }

            if (this.remainingTime <= 0) {
                this.close();
            }
        }, timerInterval);
    }

    close() {
        if (this.timer) {
            clearInterval(this.timer);
        }

        const container = this.elements.container;

        container.setAttribute("data-closing", "true");

        // Reposition remaining notifications immediately to fill the gap
        this.repositionRemainingNotifications();

        // Add exit animation
        const prefix = getCssPrefix();
        const enterClasses = `${prefix}fadeInDown`;
        const exitClasses = `${prefix}fadeOutUp`;

        container.classList.remove(enterClasses);
        container.classList.add(exitClasses);

        // Remove after animation
        setTimeout(() => {
            if (this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
            this.options.onClosed?.();
        }, 300);
    }

    private repositionRemainingNotifications() {
        const { placement } = this.options;
        const offset = 20;
        const spacing = 10;

        // Get all remaining notifications in the same position
        const positionSelector = `[data-notify-position="${placement!.from}-${
            placement!.align
        }"]:not([data-closing="true"])`;
        const remainingNotifications = document.querySelectorAll(positionSelector);

        let currentOffset = offset;

        remainingNotifications.forEach((notification) => {
            const element = notification as HTMLElement;
            element.style[placement!.from as any] = `${currentOffset}px`;
            currentOffset += element.offsetHeight + spacing;
        });
    }
}

function notify(content: NotifyContent | string, options?: NotifyOptions): Notify {
    return new Notify(content, options);
}

export default notify;
