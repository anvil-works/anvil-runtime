// data.ts: Store the actual app YAML.

import { pyObject } from "../@Sk";

export interface DataBindingYaml {
    code: string;
    property: string;
    writeback?: boolean;
}

export interface ComponentYaml {
    type: string;
    name: string;
    properties: { [prop: string]: any };
    layout_properties?: { [prop: string]: any };
    components?: ComponentYaml[]; // containers only
    event_bindings?: { [eventName: string]: string };
    data_bindings?: DataBindingYaml[];
}

export interface FormContainerYaml {
    type: string;
    properties?: { [prop: string]: any };
    event_bindings?: { [eventName: string]: string };
    data_bindings?: DataBindingYaml[];
}

export interface FormLayoutYaml {
    type: string;
    properties?: { [prop: string]: any };
    // TODO event_bindings - make sure we have a story for how to un-bind these
    //event_bindings: { [eventName: string]: string };
    // TODO data_bindings
}

export type SlotTargetType = "container" | "slot";
export interface SlotTarget {
    type: SlotTargetType;
    name: string;
}

export interface SlotDefYaml {
    target: SlotTarget;
    set_layout_properties?: { [prop: string]: any };
    one_component?: boolean;
    template?: ComponentYaml; // TODO: Not actually true. Templates don't have names.
    index: number;
}

export interface FormYaml {
    class_name: string;
    is_package?: boolean;
    code: string;
    // If this is a classic form (inherits from a container type)
    container?: FormContainerYaml;
    components?: ComponentYaml[];

    // Else, if this form uses a layout
    layout?: FormLayoutYaml;
    components_by_slot?: { [slotName: string]: ComponentYaml[] };

    // If this form *provides* slots
    slots?: { [slotName: string]: SlotDefYaml };

    // If this is a custom component:
    custom_component?: boolean;
    properties?: {
        name: string;
        type: string;
        default_value?: any;
        description?: string;
        important?: boolean;
        group?: string;
        options?: string[];
    }[];
    events?: {
        name: string;
        parameters?: { name: string; description: string }[];
        description?: string;
        default_event?: boolean;
    }[];

    item_type?: any; // TODO express this type properly
}

export interface ModuleYaml {
    name: string;
    is_package?: boolean;
    code: string;
}

interface DependencyCode {
    [depId: string]: DependencyYaml;
}

interface ThemeColors {
    [color: string]: string;
}

interface ThemeVars {
    [varName: string]: string;
}

export interface DependencyYaml {
    package_name?: string; // some old apps are missing packages and we need to cope
    forms: FormYaml[];
    modules: ModuleYaml[];
    runtime_options: { client_version?: string; version?: number };
}

export interface AppConfig {
    name: string;
    package_name?: string; // some old apps are missing packages and we need to cope
    theme: {
        color_scheme: ThemeColors;
        vars: ThemeVars;
        html?: { [filename: string]: string };
    };
    services?: { source: string; client_config: object }[];
    runtime_options: { client_version?: string; version?: number };
}

export interface AppYaml extends DependencyYaml, AppConfig {
    //server_modules: ModuleYaml[]; - not in client
    //dependencies: {app_id: string, version: any}[];
    dependency_code: DependencyCode; // client version
}

interface ServerParams {
    consoleMessage?: string;
    ideOrigin?: string;
    runtimeVersion: number;
    [param: string]: any;
}

interface Data {
    app: AppYaml;
    appId: string;
    appPackage: string;
    dependencyPackages: { [depId: string]: string };
    appOrigin: string;
    serverParams: ServerParams;
}

export let data: Data;

declare global {
    interface Window {
        anvilCDNOrigin: string;
        anvilAppDependencies: DependencyCode;
        debugAnvilData: Data;
        anvilAppMainPackage: string;
        anvilParams: ServerParams & { appId: string; appOrigin: string };
        anvilAppOrigin: string;
        anvilServiceClientConfig: any;
        anvilCustomComponentProperties: any;
        anvilThemeColors: ThemeColors;
        anvilThemeVars: ThemeVars;
        anvilCurrentlyConstructingForms: { name: string; pyForm: pyObject }[];
        anvilSkulptLib: string;
        anvilFormTemplates: any[];
        anvilSessionToken: string;
        anvilVersion: number;
    }
}

export type SetDataParams = Pick<Data, "app" | "appId" | "appOrigin"> & ServerParams;

export function temporaryHackSetupData(d: Partial<Data>) {
    data = d as Data;
}

export function setData({ app, appId, appOrigin, ...serverParams }: SetDataParams) {
    const dependencyPackages = Object.fromEntries(
        Object.entries(app.dependency_code)
            .map(([id, { package_name }]) => [id, package_name])
            .filter(([_id, package_name]) => package_name !== undefined)
    );

    data = { app, appId, appOrigin, serverParams, appPackage: app.package_name || "main_package", dependencyPackages };

    //used by RepeatingPanel
    window.anvilAppDependencies = data.app.dependency_code;

    //for debug purposes
    window.debugAnvilData = data;

    //used by openForm(), RepeatingPanel & others
    window.anvilAppMainPackage = data.appPackage;

    window.anvilParams = { appId, appOrigin, ...serverParams };

    // {path => config}
    window.anvilServiceClientConfig = Object.fromEntries(
        (app.services ?? []).map(({ source, client_config }) => [source, client_config])
    );

    const customComponentProperties: any = {};

    const updateCustomProperties = (depId: string | null, { forms }: DependencyYaml) => {
        if (!forms) return; // can this be null?
        for (const { custom_component, class_name, properties } of forms) {
            if (!custom_component) continue;
            customComponentProperties[depId + ":" + class_name] = properties;
        }
    };

    updateCustomProperties(null, app);

    for (const [depId, depYaml] of Object.entries(app.dependency_code)) {
        updateCustomProperties(depId, depYaml);
    }

    window.anvilCustomComponentProperties = customComponentProperties;

    // We convert to a python dict in app.theme_colors
    // parallels designer.html and also anvil-extras uses this in the designer for dynamic colors.
    window.anvilThemeColors = data.app.theme?.color_scheme ?? {};
    window.anvilThemeVars = data.app.theme?.vars ?? {};
}
