import {
    LEGACY_CUSTOM_COMPONENT_SPEC,
    LEGACY_CUSTOM_COMPONENT_SPEC_PREFIX,
    LEGACY_DEPENDENCY_FORM_PROPERTY_SPEC,
    PACKAGE_QUALIFIED_FORM_NAME,
} from "./component-spec-constants";
import { data } from "./data";

export {
    LEGACY_CUSTOM_COMPONENT_SPEC,
    LEGACY_CUSTOM_COMPONENT_SPEC_PREFIX,
    LEGACY_DEPENDENCY_FORM_PROPERTY_SPEC,
    PACKAGE_QUALIFIED_FORM_NAME,
} from "./component-spec-constants";

/**
 * Runtime parsers for two persisted strings that identify form-backed
 * components.
 *
 * A customComponentSpec is the value of a component YAML `type` field when the
 * component is a form-backed custom component. Accepted formats:
 * - legacy local: `form:Form1`
 * - legacy dependency: `form:dep_abc:Foo.Form1`
 * - packageQualifiedFormName: `AppPackage.Foo.Form1`
 *
 * A formPropertySpec is the string value of a form-typed component property,
 * such as RepeatingPanel `item_template`. Accepted formats:
 * - appLocalFormName: `Form1` or `Foo.Form1`
 * - dependency appLocalFormName: `dep_abc:Foo.Form1`
 * - packageQualifiedFormName: `AppPackage.Foo.Form1`
 *
 * Supporting terms used below:
 * - appLocalFormName: the app's own form name from `forms[*].class_name`,
 *   derived from the `client_code` path and not prefixed with `package_name`;
 *   examples: `Form1`, `Foo.Form1`.
 * - packageQualifiedFormName: a Python package name plus an appLocalFormName;
 *   example: `AppPackage.Foo.Form1`.
 * - logicalDepId: legacy dependency alias used in specs, such as `dep_abc`.
 * - defaultDepAppId: resolved dependency app ID used as the default app context
 *   when a spec does not include a packageName or logicalDepId.
 */

/**
 * Parsed, normalized runtime target for a form class import.
 */
export interface ParsedFormSpec {
    /** Python package name for the local app, a dependency, or an unknown package. */
    packageName: string;
    /** The appLocalFormName portion of the target form. */
    appLocalFormName: string;
    /** Last segment of appLocalFormName; this is the class name inside the imported module. */
    leafName: string;
    /** Python package name plus appLocalFormName; this is the module name used for import. */
    packageQualifiedFormName: string;
    /** Resolved dependency app ID for dependency components, or null for the local app or an unknown package. */
    depAppId: string | null;
    /** logicalDepId from a legacy spec, if one was present or can be recovered. */
    logicalDepId: string | null;
    /** True when the input used legacy customComponentSpec or formPropertySpec syntax. */
    legacy: boolean;
}

export interface ParseCustomComponentSpecOptions {
    /**
     * Treat unknown packageQualifiedFormNames as absolute Python imports.
     *
     * When false, `some_package.Form1` is accepted only if `some_package`
     * matches the local app package or a loaded dependency package. When true,
     * the same input returns a parsed spec even for unknown packages, allowing
     * the caller to try importing `some_package.Form1` instead of falling back
     * to built-in component lookup.
     */
    allowUnknownPackage?: boolean;
}

const logicalDepIdForDepAppId = (depAppId: string | null): string | null => {
    if (!depAppId) {
        return null;
    }
    return data.logicalDepIdByDepAppId[depAppId] ?? null;
};

const isKnownPackageName = (packageName: string): boolean =>
    packageName === data.appPackage || data.depAppIdByPackageName[packageName] !== undefined;

const appLocalFormNameExists = (appLocalFormName: string, defaultDepAppId: string | null): boolean =>
    data.appLocalFormNamesByDepAppId[defaultDepAppId ?? "local"]?.has(appLocalFormName) ?? false;

// Not every parse path gets appLocalFormName from a regex match. Exact
// formPropertySpec matches and non-dotted fallback values arrive here directly,
// so derive leafName once when building the ParsedFormSpec.
const leafNameFromAppLocalFormName = (appLocalFormName: string): string => {
    const lastDot = appLocalFormName.lastIndexOf(".");
    return lastDot === -1 ? appLocalFormName : appLocalFormName.substring(lastDot + 1);
};

const parsedAppLocalFormName = (
    appLocalFormName: string,
    defaultDepAppId: string | null,
    logicalDepId: string | null = null
): ParsedFormSpec | null => {
    const depAppId = logicalDepId ? (data.logicalDepIds[logicalDepId] ?? null) : defaultDepAppId;
    const packageName = depAppId ? data.dependencyPackages[depAppId] : data.appPackage;
    if (!packageName && !(logicalDepId && !depAppId)) {
        return null;
    }
    const resolvedPackageName = packageName || data.appPackage;

    return {
        packageName: resolvedPackageName,
        appLocalFormName,
        leafName: leafNameFromAppLocalFormName(appLocalFormName),
        packageQualifiedFormName: `${resolvedPackageName}.${appLocalFormName}`,
        depAppId,
        logicalDepId: logicalDepId ?? logicalDepIdForDepAppId(depAppId),
        legacy: true,
    };
};

const parseLegacyCustomComponentSpec = (
    customComponentSpec: string,
    defaultDepAppId: string | null
): ParsedFormSpec | null => {
    const match = customComponentSpec.match(LEGACY_CUSTOM_COMPONENT_SPEC);
    if (!match) {
        return null;
    }
    const [, logicalDepId = null, appLocalFormName] = match;
    return parsedAppLocalFormName(appLocalFormName, defaultDepAppId, logicalDepId);
};

const parsePackageQualifiedFormName = (
    packageQualifiedFormName: string,
    {
        allowUnknownPackage = false,
        rejectAnvilPackage = false,
    }: ParseCustomComponentSpecOptions & { rejectAnvilPackage?: boolean } = {}
): ParsedFormSpec | null => {
    const match = packageQualifiedFormName.match(PACKAGE_QUALIFIED_FORM_NAME);
    if (!match || (rejectAnvilPackage && packageQualifiedFormName.startsWith("anvil."))) {
        return null;
    }

    const [, packageName, appLocalFormName] = match;
    if (!isKnownPackageName(packageName)) {
        if (!allowUnknownPackage) {
            return null;
        }
        return {
            packageName,
            appLocalFormName,
            leafName: leafNameFromAppLocalFormName(appLocalFormName),
            packageQualifiedFormName,
            depAppId: null,
            logicalDepId: null,
            legacy: false,
        };
    }

    const depAppId = packageName === data.appPackage ? null : data.depAppIdByPackageName[packageName];
    return {
        packageName,
        appLocalFormName,
        leafName: leafNameFromAppLocalFormName(appLocalFormName),
        packageQualifiedFormName,
        depAppId,
        logicalDepId: logicalDepIdForDepAppId(depAppId),
        legacy: false,
    };
};

/**
 * Parse a customComponentSpec.
 *
 * Built-in component types such as `Button` and `anvil.Button` are not
 * customComponentSpecs. They return null so callers can use the existing
 * built-in component lookup path.
 */
export const parseCustomComponentSpec = (
    customComponentSpec: string,
    defaultDepAppId: string | null,
    { allowUnknownPackage = false }: ParseCustomComponentSpecOptions = {}
): ParsedFormSpec | null => {
    if (customComponentSpec.startsWith(LEGACY_CUSTOM_COMPONENT_SPEC_PREFIX)) {
        return parseLegacyCustomComponentSpec(customComponentSpec, defaultDepAppId);
    }

    return parsePackageQualifiedFormName(customComponentSpec, {
        allowUnknownPackage,
        rejectAnvilPackage: true,
    });
};

/**
 * Parse a formPropertySpec.
 *
 * Compatibility rule for ambiguity: if a dotted formPropertySpec exactly
 * matches a `forms[*].class_name` in the default app context, treat it as an
 * appLocalFormName. Otherwise, dotted formPropertySpecs are interpreted as
 * packageQualifiedFormNames.
 */
export const parseFormPropertySpec = (
    formPropertySpec: string,
    defaultDepAppId: string | null
): ParsedFormSpec | null => {
    // A legacy customComponentSpec is not a formPropertySpec. Reject it before
    // the legacy dependency formPropertySpec parser can read `form` as a
    // logicalDepId.
    if (formPropertySpec.startsWith(LEGACY_CUSTOM_COMPONENT_SPEC_PREFIX)) {
        return null;
    }

    const dependencyMatch = formPropertySpec.match(LEGACY_DEPENDENCY_FORM_PROPERTY_SPEC);
    if (dependencyMatch) {
        const [, logicalDepId, appLocalFormName] = dependencyMatch;
        return parsedAppLocalFormName(appLocalFormName, defaultDepAppId, logicalDepId);
    }

    if (appLocalFormNameExists(formPropertySpec, defaultDepAppId)) {
        return parsedAppLocalFormName(formPropertySpec, defaultDepAppId);
    }

    const packageQualifiedSpec = parsePackageQualifiedFormName(formPropertySpec, { allowUnknownPackage: true });
    if (packageQualifiedSpec) {
        return packageQualifiedSpec;
    }

    // Unknown values without dots cannot be packageQualifiedFormNames. Keep
    // returning an appLocalFormName identity so later import errors match the
    // legacy formPropertySpec path.
    return parsedAppLocalFormName(formPropertySpec, defaultDepAppId);
};
