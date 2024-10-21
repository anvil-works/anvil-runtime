/// <reference types="node" />
// File: runtime/packaging/package-py.js

const fs = require("fs").promises;
const path = require("path");

/**
 * Recursively collects all .py files in a directory.
 * @param {string} dir - Directory path to traverse.
 * @returns {Promise<string[]>} - Array of .py file paths.
 */
async function getAllPyFiles(dir) {
    let pyFiles = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const subDirFiles = await getAllPyFiles(fullPath);
            pyFiles = pyFiles.concat(subDirFiles);
        } else if (entry.isFile() && path.extname(entry.name) === ".py") {
            pyFiles.push(fullPath);
        }
    }

    return pyFiles;
}

/**
 * Replaces the path prefix from 'runtime/client/py/' to 'src/lib/'.
 * @param {string} filePath - Absolute path to the .py file.
 * @returns {string} - Modified path.
 */
function replacePrefix(filePath) {
    const normalizedPath = filePath.split(path.sep).join("/");
    return normalizedPath.replace(/^.*runtime\/client\/py\//, "src/lib/");
}

/**
 * Normalizes line endings to Unix-style (\n).
 * @param {string} content - Original file content.
 * @returns {string} - Normalized content.
 */
function normalizeLineEndings(content) {
    return content.replace(/\r\n?/g, "\n");
}

/**
 * Processes all .py files and generates the destination JS file.
 * @param {string} srcDir - Source directory containing .py files.
 * @param {string} destFile - Destination JS file path.
 */
async function processFiles(srcDir, destFile) {
    const files = await getAllPyFiles(srcDir);
    let output = "";

    for (const file of files) {
        let content = await fs.readFile(file, "utf-8");
        content = normalizeLineEndings(content);
        const modifiedPath = replacePrefix(file);
        const jsonContent = JSON.stringify(content);
        output += `Sk.builtinFiles.files['${modifiedPath}']=${jsonContent};`;
    }

    await fs.writeFile(destFile, output, { encoding: "UTF-8" });
    console.log(`Packaging completed successfully. Output file: ${destFile}`);
}

const SRC_DIR = path.resolve(__dirname, "../py");
const DEST_FILE = path.resolve(__dirname, "../js/extra-python-modules.js");

try {
    processFiles(SRC_DIR, DEST_FILE);
} catch (error) {
    console.error("Error during packaging:", error);
    process.exit(1);
}
