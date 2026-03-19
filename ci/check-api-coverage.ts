#!/usr/bin/env npx tsx
/**
 * API Coverage Checker
 *
 * Parses OpenAPI spec(s) and scans frontend source to find endpoints that
 * exist in the spec but are never called in the frontend code.
 *
 * Usage:
 *   npx tsx ci/check-api-coverage.ts                     # check all specs
 *   npx tsx ci/check-api-coverage.ts --strict             # exit 1 if any uncovered (for CI)
 *   npx tsx ci/check-api-coverage.ts --only forumline-api # check one spec
 *   npx tsx ci/check-api-coverage.ts --only forum-engine  # check one spec
 *   npx tsx ci/check-api-coverage.ts --debug              # show all detected calls
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYAML } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// --- Configuration ---

interface SpecConfig {
	name: string;
	specPath: string;
	frontendDirs: string[];
	/** File extensions to scan */
	extensions: string[];
	/** Endpoints to ignore (key: "METHOD /path", value: reason) */
	ignored: Record<string, string>;
}

const SPECS: SpecConfig[] = [
	{
		name: "forumline-api",
		specPath: join(ROOT, "services/forumline-api/openapi.yaml"),
		frontendDirs: [join(ROOT, "packages/frontend/client-sdk/src")],
		extensions: [".ts"],
		ignored: {
			"GET /api/health": "Server health check, not a user-facing endpoint",
			"POST /api/webhooks/notification":
				"Inbound webhook from forum->platform, server-to-server only",
			"POST /api/webhooks/notifications":
				"Inbound webhook from forum->platform, server-to-server only",
		},
	},
	{
		name: "forum-engine",
		specPath: join(ROOT, "packages/forum/openapi.yaml"),
		frontendDirs: [join(ROOT, "services/hosted/src")],
		extensions: [".js"],
		ignored: {
			"GET /api/forumline/auth": "Redirect flow, browser navigates directly",
			"GET /api/forumline/auth/callback":
				"OAuth callback, browser navigates directly",
			"GET /api/forumline/auth/session":
				"Session check used internally by auth.js via cookie, not explicit fetch",
		},
	},
];

// --- Parse OpenAPI specs ---

interface SpecEndpoint {
	method: string;
	path: string;
	spec: string;
}

function extractEndpoints(specPath: string, specName: string): SpecEndpoint[] {
	const raw = readFileSync(specPath, "utf8");
	const spec = parseYAML(raw);
	const endpoints: SpecEndpoint[] = [];
	const methods = ["get", "post", "put", "patch", "delete"];

	for (const [path, pathObj] of Object.entries(
		spec.paths as Record<string, Record<string, unknown>>,
	)) {
		for (const method of Object.keys(pathObj)) {
			if (methods.includes(method)) {
				endpoints.push({
					method: method.toUpperCase(),
					path,
					spec: specName,
				});
			}
		}
	}
	return endpoints;
}

// --- Scan frontend source ---

/** Recursively collect files with given extensions, skipping generated files */
function collectFiles(dir: string, extensions: string[]): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
			results.push(...collectFiles(full, extensions));
		} else if (entry.isFile() && extensions.includes(extname(entry.name))) {
			// Skip generated files
			if (entry.name.endsWith(".gen.ts") || entry.name.endsWith(".gen.js")) continue;
			results.push(full);
		}
	}
	return results;
}

/**
 * Extract the balanced content of the call starting at `(` position.
 */
function extractCallArgs(content: string, openParenIdx: number): string {
	let depth = 0;
	for (let i = openParenIdx; i < content.length && i < openParenIdx + 2000; i++) {
		if (content[i] === "(") depth++;
		else if (content[i] === ")") {
			depth--;
			if (depth === 0) return content.slice(openParenIdx + 1, i);
		}
	}
	return content.slice(openParenIdx + 1, openParenIdx + 500);
}

/**
 * Extract the HTTP method from a fetch options object (default: GET).
 */
function extractMethod(argsStr: string): string {
	const m = argsStr.match(/method:\s*['"](\w+)['"]/);
	return m ? m[1].toUpperCase() : "GET";
}

/**
 * Reconstruct an API path from a string concatenation expression.
 * '/api/calls/' + variable + '/respond' => '/api/calls/{param}/respond'
 */
function reconstructConcatPath(expr: string): string {
	const literals = [...expr.matchAll(/'([^']*)'/g)].map((m) => m[1]);
	if (literals.length === 0) return "";
	let result = literals[0];
	for (let i = 1; i < literals.length; i++) {
		result += "{param}" + literals[i];
	}
	return result;
}

/** Strip query params */
function normalizePath(path: string): string {
	return path.split("?")[0];
}

/** Check if a spec path matches a found path (handles OpenAPI template params) */
function pathMatches(specPath: string, foundPath: string): boolean {
	if (specPath === foundPath) return true;
	const pattern = specPath.replace(/\{[^}]+\}/g, "[^/]+");
	return new RegExp(`^${pattern}$`).test(foundPath);
}

function scanFrontend(dirs: string[], extensions: string[]): Set<string> {
	const found = new Set<string>();

	const files: string[] = [];
	for (const dir of dirs) {
		files.push(...collectFiles(dir, extensions));
	}

	for (const filePath of files) {
		const content = readFileSync(filePath, "utf8");

		// 1. Typed openapi-fetch client: _client.GET('/api/...', ...)
		const typedRe = /_client\.(GET|POST|PUT|PATCH|DELETE)\(\s*'([^']+)'/g;
		let m: RegExpExecArray | null;
		while ((m = typedRe.exec(content))) {
			found.add(`${m[1]} ${m[2]}`);
		}

		// 2. Raw fetch('/api/...', { method: ... }) — path as string literal
		const fetchLitRe = /fetch\(\s*'(\/api\/[^']+)'/g;
		while ((m = fetchLitRe.exec(content))) {
			const args = extractCallArgs(content, m.index + 5);
			const method = extractMethod(args);
			found.add(`${method} ${normalizePath(m[1])}`);
		}

		// 3. Raw fetch with template literal: fetch(`/api/...`)
		const fetchTplRe = /fetch\(\s*`(\/api\/[^`]+)`/g;
		while ((m = fetchTplRe.exec(content))) {
			const args = extractCallArgs(content, m.index + 5);
			const method = extractMethod(args);
			const path = m[1].replace(/\$\{[^}]+\}/g, "{param}");
			found.add(`${method} ${normalizePath(path)}`);
		}

		// 4. apiFetch('/api/path', { method: ... })
		const apiFetchRe = /apiFetch[<(]/g;
		while ((m = apiFetchRe.exec(content))) {
			const parenIdx = content.indexOf("(", m.index);
			if (parenIdx === -1) continue;
			const args = extractCallArgs(content, parenIdx);
			const firstArg = args.split(/,\s*\{/)[0].trim();
			let path: string;
			if (firstArg.includes("+")) {
				path = reconstructConcatPath(firstArg);
			} else {
				const pathMatch = firstArg.match(/'([^']+)'/);
				if (!pathMatch) continue;
				path = pathMatch[1];
			}
			if (!path.startsWith("/api/")) continue;
			const method = extractMethod(args);
			found.add(`${method} ${normalizePath(path)}`);
		}

		// 5. api.js helper wrappers: get('/api/...'), post('/api/...'), etc.
		//    These are the forum frontend's api client helpers.
		const helperRe = /\b(get|post|put|patch|del)\(\s*['`](\/api\/[^'`]+)['`]/g;
		while ((m = helperRe.exec(content))) {
			const method = m[1] === "del" ? "DELETE" : m[1].toUpperCase();
			const path = m[2].replace(/\$\{[^}]+\}/g, "{param}");
			found.add(`${method} ${normalizePath(path)}`);
		}

		// 6. connectSSE('/api/...') — SSE stream endpoints
		const sseRe = /connectSSE\(\s*['`](\/api\/[^'`]+)['`]/g;
		while ((m = sseRe.exec(content))) {
			const path = m[1].replace(/\$\{[^}]+\}/g, "{param}");
			found.add(`GET ${normalizePath(path)}`);
		}

		// 7. EventSource URLs
		const esRe = /new\s+EventSource\(\s*[`'"]?(\/api\/[^`'"?\s]+)/g;
		while ((m = esRe.exec(content))) {
			found.add(`GET ${normalizePath(m[1])}`);
		}

		// 8. URL string references (catch-all for paths we see but can't determine method)
		const urlVarRe = /[`'](\/api\/[^`'"?\s]+)/g;
		while ((m = urlVarRe.exec(content))) {
			const path = m[1].replace(/\$\{[^}]+\}/g, "{param}");
			found.add(`REF ${normalizePath(path)}`);
		}
	}

	return found;
}

// --- Reporting ---

interface Report {
	name: string;
	total: number;
	covered: SpecEndpoint[];
	uncovered: SpecEndpoint[];
	ignored: SpecEndpoint[];
}

function checkSpec(spec: SpecConfig, debug: boolean): Report {
	const endpoints = extractEndpoints(spec.specPath, spec.name);
	const calls = scanFrontend(spec.frontendDirs, spec.extensions);

	if (debug) {
		console.log(`\n  [${spec.name}] Frontend calls found:`);
		for (const call of [...calls].sort()) {
			console.log(`     ${call}`);
		}
	}

	const covered: SpecEndpoint[] = [];
	const uncovered: SpecEndpoint[] = [];
	const ignored: SpecEndpoint[] = [];

	for (const ep of endpoints) {
		const key = `${ep.method} ${ep.path}`;
		if (spec.ignored[key]) {
			ignored.push(ep);
			continue;
		}

		const matched = [...calls].some((call) => {
			const [callMethod, ...callPathParts] = call.split(" ");
			const callPath = callPathParts.join(" ");
			if (callMethod === ep.method && pathMatches(ep.path, callPath)) return true;
			if (callMethod === "REF" && pathMatches(ep.path, callPath)) return true;
			return false;
		});

		if (matched) {
			covered.push(ep);
		} else {
			uncovered.push(ep);
		}
	}

	const total = endpoints.length - ignored.length;
	return { name: spec.name, total, covered, uncovered, ignored };
}

function printReport(report: Report): void {
	const { name, total, covered, uncovered, ignored } = report;
	const pct = total > 0 ? ((covered.length / total) * 100).toFixed(1) : "100.0";

	console.log(`\n  === ${name} ===\n`);

	if (covered.length > 0) {
		console.log(`  Covered (${covered.length}):`);
		for (const ep of covered) {
			console.log(`   ${ep.method} ${ep.path}`);
		}
	}

	if (ignored.length > 0) {
		console.log(`\n  Ignored (${ignored.length}):`);
		for (const ep of ignored) {
			// Find the spec config to get the reason
			const spec = SPECS.find((s) => s.name === ep.spec);
			const reason = spec?.ignored[`${ep.method} ${ep.path}`] ?? "";
			console.log(`   ${ep.method} ${ep.path} -- ${reason}`);
		}
	}

	if (uncovered.length > 0) {
		console.log(`\n  UNCOVERED (${uncovered.length}):`);
		for (const ep of uncovered) {
			console.log(`   ${ep.method} ${ep.path}`);
		}
	}

	console.log(`\n  Coverage: ${covered.length}/${total} (${pct}%)`);
}

// --- Main ---

const strict = process.argv.includes("--strict");
const debug = process.argv.includes("--debug");
const onlyIdx = process.argv.indexOf("--only");
const onlyName = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null;

const specsToCheck = onlyName
	? SPECS.filter((s) => s.name === onlyName)
	: SPECS;

if (onlyName && specsToCheck.length === 0) {
	console.error(`Unknown spec: ${onlyName}. Available: ${SPECS.map((s) => s.name).join(", ")}`);
	process.exit(1);
}

let hasUncovered = false;

for (const spec of specsToCheck) {
	const report = checkSpec(spec, debug);
	printReport(report);
	if (report.uncovered.length > 0) hasUncovered = true;
}

if (hasUncovered && strict) {
	console.log(
		"\n  FAIL: --strict is set and there are uncovered endpoints.",
	);
	console.log(
		"  Either add frontend calls or add them to the ignored list in ci/check-api-coverage.ts\n",
	);
	process.exit(1);
}
