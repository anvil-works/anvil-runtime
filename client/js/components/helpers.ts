// temporary
interface ClassicComponent {
    _anvil: {
        metadata?: {
            invisible?: boolean;
        };
    };
}

// Because Timers
export function isInvisibleComponent(component: any) {
    return component._anvil?.metadata?.invisible;
}
