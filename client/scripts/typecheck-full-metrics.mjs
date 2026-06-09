import { spawnSync } from "node:child_process";

const result = spawnSync(
    "pnpm",
    ["exec", "tsc", "--noEmit", "-p", "tsconfig.json", "--skipLibCheck", "--pretty", "false"],
    {
        cwd: process.cwd(),
        encoding: "utf8",
    }
);

if (result.error) {
    throw result.error;
}

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const errorLines = output
    .split(/\r?\n/)
    .filter((line) => line.includes(": error TS"))
    .filter(Boolean);

const getFileFromLine = (line) => {
    const splitIndex = line.indexOf("(");
    return splitIndex === -1 ? line : line.slice(0, splitIndex);
};

const countByFile = (lines) => {
    const byFile = new Map();
    for (const line of lines) {
        const file = getFileFromLine(line);
        byFile.set(file, (byFile.get(file) ?? 0) + 1);
    }
    return byFile;
};

const firstPartyErrorLines = errorLines.filter(
    (line) => !line.includes("/node_modules/") && !line.startsWith("dist/static/js/")
);

const topFiles = [...countByFile(errorLines).entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
const topFirstPartyFiles = [...countByFile(firstPartyErrorLines).entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

console.log(`Runtime full typecheck errors: ${errorLines.length}`);
console.log(`Runtime first-party actionable errors: ${firstPartyErrorLines.length}`);
if (topFiles.length > 0) {
    console.log("Top runtime typecheck hotspots:");
    for (const [file, count] of topFiles) {
        console.log(`  ${count.toString().padStart(4, " ")}  ${file}`);
    }
}
if (topFirstPartyFiles.length > 0) {
    console.log("Top runtime first-party hotspots:");
    for (const [file, count] of topFirstPartyFiles) {
        console.log(`  ${count.toString().padStart(4, " ")}  ${file}`);
    }
}

if (errorLines.length > 0) {
    process.exit(1);
}

if (result.status !== 0) {
    console.error(output);
    process.exit(result.status ?? 1);
}
