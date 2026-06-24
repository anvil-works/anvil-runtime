export const LEGACY_CUSTOM_COMPONENT_SPEC_PREFIX = "form:";
export const LEGACY_CUSTOM_COMPONENT_SPEC = new RegExp(`^${LEGACY_CUSTOM_COMPONENT_SPEC_PREFIX}(?:([^:]+):)?(.+)$`);
export const LEGACY_DEPENDENCY_FORM_PROPERTY_SPEC = /^([^:]+):(.+)$/;
export const PACKAGE_QUALIFIED_FORM_NAME = /^([^.]+)\.(.+)$/;
