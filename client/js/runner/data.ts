// data.ts: Store the actual app YAML.

import type {
    Component,
    CustomComponentToolboxItem,
    CustomLayoutYaml,
    DesignerHint,
    ToolboxSection,
} from "@runtime/components/Component";
import type { pyObject } from "../@Sk";

export interface DataBindingYaml {
    code: string;
    property: string;
    writeback?: boolean;
}

export type EventBindingYaml = { [eventName: string]: string };

export interface ComponentYaml {
    type: string;
    name: string;
    properties: { [prop: string]: any };
    layout_properties?: { [prop: string]: any };
    components?: ComponentYaml[]; // containers only
    event_bindings?: EventBindingYaml;
    data_bindings?: DataBindingYaml[];
}

export interface FormContainerYaml {
    type: string;
    properties?: { [prop: string]: any };
    event_bindings?: EventBindingYaml;
    data_bindings?: DataBindingYaml[];
    layout_properties?: { [prop: string]: any };
}

export interface FormLayoutYaml {
    type: string;
    properties?: { [prop: string]: any };
    event_bindings?: EventBindingYaml;
    form_event_bindings?: EventBindingYaml;
    data_bindings?: DataBindingYaml[];
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

export type SlotDefsYaml = { [slotName: string]: SlotDefYaml };

export interface CustomComponentEvents {
    name: string;
    parameters?: { name: string; description?: string }[];
    description?: string;
    default_event?: boolean;
    important?: boolean;
}

export interface LayoutMetadata {
    title?: string;
    description?: string;
    thumbnail?: string;
    internal?: boolean; // Should this layout only be offered as an option when creating forms in this app
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
    slots?: SlotDefsYaml;

    // If this is a custom component:
    custom_component?: boolean;
    custom_component_container?: boolean; // TODO is this the right place to put this?
    properties?: {
        name: string;
        type: string;
        default_value?: any;
        default_binding_prop?: boolean;
        description?: string;
        important?: boolean;
        group?: string;
        options?: string[];
        allow_binding_writeback?: boolean;
        binding_writeback_events?: string[];
        priority?: number;
        multiline?: boolean;
        accept?: string;
        designer_hint?: DesignerHint;
        include_none_option?: boolean;
        none_option_label?: string;
        iconsets?: string[];
        show_in_designer_when?: string;
    }[];
    events?: CustomComponentEvents[];
    toolbox_item?: CustomComponentToolboxItem;
    layout_metadata?: LayoutMetadata;

    item_type?: { table_id: number };
}

export interface ModuleYaml {
    name: string;
    is_package?: boolean;
    code: string;
}

export interface AssetYaml {
    name: string;
    content: string;
}

export interface DependencyCode {
    [depId: string]: DependencyYaml;
}

interface ThemeColors {
    [color: string]: string;
}

interface ThemeVars {
    [varName: string]: string;
}

export interface LegacyFeatures {
    class_names?: boolean;
    bootstrap3?: boolean;
    __dict__?: boolean;
    root_container?: boolean;
}

export interface RuntimeOptions {
    client_version?: string;
    version: number;
    preview_v3?: boolean;
    legacy_features?: LegacyFeatures;
}

export interface DepConfigSchemaDef {
    // the app yaml defines default_value and type
    // the dep yaml defines value
    [key: string]: {
        default_value?: any;
        type?: any;
        [arbitraryKeys: string]: any;
    };
}

export interface DepConfigSchema {
    client?: DepConfigSchemaDef;
    server?: DepConfigSchemaDef;
}

export interface DepConfigResolved {
    client: { [key: string]: any };
    server: { [key: string]: any };
}

export interface DependencyYaml {
    package_name?: string; // some old apps are missing packages and we need to cope
    forms: FormYaml[];
    modules: ModuleYaml[];
    runtime_options: RuntimeOptions;
    toolbox_sections?: ToolboxSection[]; // Legacy. Use toolbox.sections instead.
    toolbox?: {
        sections?: ToolboxSection[];
        hide_classic_components?: boolean;
    }
    layouts?: CustomLayoutYaml[];
    config_schema?: DepConfigSchema;
    config: DepConfigResolved;
    client_init_module?: string;
}

export interface ThemeRole {
    name: string;
    title?: string;
    components?: string[];
}

export interface AppTheme {
    color_scheme: ThemeColors;
    vars: ThemeVars;
    html?: { [filename: string]: string };
    parameters?: {
        roles: ThemeRole[];
    };
}

export interface AppConfig {
    name: string;
    package_name?: string; // some old apps are missing packages and we need to cope
    theme: AppTheme;
    services?: { source: string; client_config: any }[];
    runtime_options: RuntimeOptions;
    toolbox_sections?: ToolboxSection[]; // Legacy. Use toolbox.sections instead.
    toolbox?: {
        sections?: ToolboxSection[];
        hide_classic_components?: boolean;
    }
    layouts?: CustomLayoutYaml[];
    dependency_ids: { [logicalDepId: string]: string };
    // Temporary, while we're fixing some broken apps that worked by accident
    correct_dependency_ids: { [logicalDepId: string]: string };
    config_schema?: DepConfigSchema;
}

export interface AppYaml extends DependencyYaml, AppConfig {
    //server_modules: ModuleYaml[]; - not in client
    //dependencies: {app_id: string, version: any}[];
    dependency_code: DependencyCode; // client version
    dependency_ids: { [dep_id: string]: string };
    dependency_order: string[];
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
    logicalDepIds: { [logicalDepId: string]: string };
    appOrigin: string;
    appStartupData?: any;
    deserializedFormArgs?: any[];
    deserializedFormKwargs?: any;
    serverParams: ServerParams;
}

export let data: Data;

declare global {
    interface Window {
        anvilCDNOrigin: string;
        anvilAppDependencies: DependencyCode;
        anvilAppDependencyIds: { [depId: string]: string };
        debugAnvilData: Data;
        anvilAppMainPackage: string;
        anvilAppMainModule: string;
        anvilParams: ServerParams & { appId: string; appOrigin: string };
        anvilAppOrigin: string;
        anvilEnvironmentOrigin: string;
        anvilServiceClientConfig: any;
        anvilCustomComponentProperties: any;
        anvilThemeColors: ThemeColors;
        anvilThemeVars: ThemeVars;
        anvilCurrentlyConstructingForms: { name: string; pyForm: pyObject }[];
        anvilSkulptLib: string;
        anvilFormTemplates: any[];
        anvilSessionToken: string;
        anvilVersion: number;
        anvilRuntimeVersion: number;
    }
}

window.anvilRuntimeVersion = 3; // At some point we may need to load this from the app.

export type SetDataParams = Pick<Data, "app" | "appId" | "appOrigin" | "appStartupData"> & ServerParams;

export function temporaryHackSetupData(d: Partial<Data>) {
    data = d as Data;
    window.debugAnvilData = data;
}

export function setData({ app, appId, appOrigin, ...serverParams }: SetDataParams) {
    const dependencyPackages = Object.fromEntries(
        Object.entries(app.dependency_code)
            .map(([id, { package_name }]) => [id, package_name])
            .filter(([_id, package_name]) => package_name !== undefined)
    );

    data = {
        app,
        appId,
        appOrigin,
        serverParams,
        appPackage: app.package_name || "main_package",
        dependencyPackages,
        logicalDepIds: app.dependency_ids,
    };

    //used by RepeatingPanel
    window.anvilAppDependencies = data.app.dependency_code;
    window.anvilAppDependencyIds = data.app.dependency_ids;

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

    const updateCustomProperties = (depAppId: string | null, { forms }: DependencyYaml) => {
        if (!forms) return; // can this be null?
        for (const { custom_component, class_name, properties } of forms) {
            if (!custom_component) continue;
            customComponentProperties[depAppId + ":" + class_name] = properties;
        }
    };

    updateCustomProperties(null, app);

    for (const [depAppId, depYaml] of Object.entries(app.dependency_code)) {
        updateCustomProperties(depAppId, depYaml);
    }

    window.anvilCustomComponentProperties = customComponentProperties;

    // We convert to a python dict in app.theme_colors
    // parallels designer.html and also anvil-extras uses this in the designer for dynamic colors.
    window.anvilThemeColors = data.app.theme?.color_scheme ?? {};
    window.anvilThemeVars = data.app.theme?.vars ?? {};
}

export const topLevelForms = {
    openForm: null as null | Component,
    alertForms: new Set<Component>(),
    has(c: Component) {
        return topLevelForms.openForm === c || topLevelForms.alertForms.has(c);
    },
};

const EmptyObject = {};

export const getClientConfig = (packageName?: string) => {
    // we're calling this too early from javascript - return undefined and the js can handle it how it likes
    if (!data) return;
    if (packageName === undefined || packageName === data.appPackage) {
        return data.app.config?.client ?? EmptyObject;
    } else {
        for (const dep of Object.values(data.app?.dependency_code ?? {})) {
            if (packageName === dep.package_name) {
                return dep.config?.client ?? EmptyObject;
            }
        }
        throw new Error(`Package '${packageName}' is not part of this app.`);
    }
};
