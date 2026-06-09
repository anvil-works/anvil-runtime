import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outRoot = join(root, "../../platform/editor/react/.cache/ide-typecheck-deps/runtime-client");

for (const path of ["js/@Sk/namespace.d.ts", "js/@Sk/abstr/index.d.ts", "js/@Sk/abstr/build_native_class.d.ts"]) {
    const dest = join(outRoot, path.slice("js/".length));
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(root, path), dest);
}
