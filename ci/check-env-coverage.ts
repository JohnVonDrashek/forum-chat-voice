#!/usr/bin/env npx tsx
/**
 * Environment Variable Coverage Checker
 *
 * Scans Go source for os.Getenv / os.LookupEnv calls and compares against
 * what's actually provisioned in secrets.kdbx for each service.
 *
 * Usage:
 *   npx tsx ci/check-env-coverage.ts                        # check all services
 *   npx tsx ci/check-env-coverage.ts --only forumline-prod   # check one service
 *   npx tsx ci/check-env-coverage.ts --strict                # exit 1 on gaps
 *   npx tsx ci/check-env-coverage.ts --debug                 # show all detected vars
 */

import { execSync } from "child_process";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname, extname, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SECRETS_DB = join(ROOT, "secrets.kdbx");

// --- Configuration ---

interface ServiceConfig {
	/** KeePass group name (matches ci/secrets.sh argument) */
	group: string;
	/** Go source directories to scan for os.Getenv calls */
	sourceDirs: string[];
	/** Env vars injected by docker-compose (not in KeePass) */
	composeDefined: string[];
	/** Env vars that are optional or have defaults in code */
	optional: string[];
	/** Env vars consumed but intentionally not in this group (shared/hardcoded) */
	ignored: Record<string, string>;
}

const SERVICES: ServiceConfig[] = [
	{
		group: "forumline-prod",
		sourceDirs: [
			join(ROOT, "services/forumline-api"),
			join(ROOT, "packages/backend"),
		],
		composeDefined: ["VALKEY_URL", "NATS_URL"],
		optional: ["DB_MAX_CONNS", "TRUST_PROXY"],
		ignored: {
			HOSTED_PLATFORM_URL:
				"URL of the hosted service, hardcoded or configured at deploy time",
		},
	},
	{
		group: "hosted-prod",
		sourceDirs: [
			join(ROOT, "services/hosted"),
			join(ROOT, "packages/backend"),
			join(ROOT, "packages/forum"),
		],
		composeDefined: ["VALKEY_URL", "NATS_URL"],
		optional: ["DB_MAX_CONNS", "TRUST_PROXY", "PORT"],
		ignored: {},
	},
];

// --- Scan Go source for env var reads ---

function collectGoFiles(dir: string): string[] {
	const results: string[] = [];
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (["vendor", "node_modules", "dist", ".git", "testdata"].includes(entry.name)) continue;
				results.push(...collectGoFiles(full));
			} else if (entry.isFile() && entry.name.endsWith(".go")) {
				// Skip generated files
				if (entry.name.endsWith(".gen.go")) continue;
				results.push(full);
			}
		}
	} catch {
		// directory doesn't exist
	}
	return results;
}

interface EnvVarUsage {
	name: string;
	file: string;
	line: number;
}

function scanGoSource(dirs: string[]): EnvVarUsage[] {
	const usages: EnvVarUsage[] = [];
	const seen = new Set<string>();

	for (const dir of dirs) {
		for (const filePath of collectGoFiles(dir)) {
			const content = readFileSync(filePath, "utf8");
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				// Match os.Getenv("VAR") and os.LookupEnv("VAR")
				const re = /os\.(?:Getenv|LookupEnv)\("([^"]+)"\)/g;
				let m: RegExpExecArray | null;
				while ((m = re.exec(line))) {
					usages.push({
						name: m[1],
						file: relative(ROOT, filePath),
						line: i + 1,
					});
				}
			}
		}
	}

	return usages;
}

// --- Read KeePass entries ---

function getKeePassEntries(group: string): string[] {
	try {
		// Try KEEPASS_PASSWORD env var first, then macOS Keychain
		let master: string;
		if (process.env.KEEPASS_PASSWORD) {
			master = process.env.KEEPASS_PASSWORD;
		} else {
			master = execSync(
				"security find-generic-password -a master -s forumline-secrets -w 2>/dev/null",
				{ encoding: "utf8" },
			).trim();
		}

		const output = execSync(
			`printf '%s\\n' "${master}" | keepassxc-cli ls "${SECRETS_DB}" "${group}/" -q 2>/dev/null`,
			{ encoding: "utf8" },
		);

		return output
			.trim()
			.split("\n")
			.filter((s) => s.length > 0);
	} catch {
		console.error(`  Warning: Could not read KeePass group "${group}". Is keepassxc-cli installed?`);
		return [];
	}
}

// --- Reporting ---

interface Report {
	group: string;
	consumed: EnvVarUsage[];
	provided: string[];
	missing: string[];       // consumed but not provided
	unused: string[];        // provided but not consumed
	composeCovered: string[]; // consumed and provided by docker-compose
	optionalMissing: string[]; // consumed but optional (has defaults)
}

function checkService(svc: ServiceConfig, debug: boolean): Report {
	const usages = scanGoSource(svc.sourceDirs);
	const provided = getKeePassEntries(svc.group);

	// Unique env var names consumed
	const consumedNames = [...new Set(usages.map((u) => u.name))];

	if (debug) {
		console.log(`\n  [${svc.group}] Env vars consumed in Go source:`);
		for (const u of usages) {
			console.log(`     ${u.name}  (${u.file}:${u.line})`);
		}
		console.log(`\n  [${svc.group}] KeePass entries:`);
		for (const e of provided) {
			console.log(`     ${e}`);
		}
	}

	const providedSet = new Set(provided);
	const composeSet = new Set(svc.composeDefined);
	const optionalSet = new Set(svc.optional);
	const ignoredSet = new Set(Object.keys(svc.ignored));

	// Find consumed vars not in KeePass, docker-compose, or ignored
	const missing: string[] = [];
	const composeCovered: string[] = [];
	const optionalMissing: string[] = [];

	for (const name of consumedNames) {
		if (providedSet.has(name)) continue;
		if (ignoredSet.has(name)) continue;

		if (composeSet.has(name)) {
			composeCovered.push(name);
		} else if (optionalSet.has(name)) {
			optionalMissing.push(name);
		} else {
			missing.push(name);
		}
	}

	// Find KeePass entries not consumed by any Go code
	const consumedSet = new Set(consumedNames);
	const unused = provided.filter(
		(e) => !consumedSet.has(e),
	);

	return {
		group: svc.group,
		consumed: usages,
		provided,
		missing,
		unused,
		composeCovered,
		optionalMissing,
	};
}

function printReport(report: Report, svc: ServiceConfig): void {
	const { group, consumed, provided, missing, unused, composeCovered, optionalMissing } = report;
	const consumedNames = [...new Set(consumed.map((u) => u.name))];

	console.log(`\n  === ${group} ===\n`);
	console.log(`  Env vars consumed: ${consumedNames.length}`);
	console.log(`  KeePass entries:   ${provided.length}`);

	// Covered
	const coveredInKeePass = consumedNames.filter((n) => provided.includes(n));
	if (coveredInKeePass.length > 0) {
		console.log(`\n  Covered by KeePass (${coveredInKeePass.length}):`);
		for (const name of coveredInKeePass.sort()) {
			console.log(`   ${name}`);
		}
	}

	if (composeCovered.length > 0) {
		console.log(`\n  Covered by docker-compose (${composeCovered.length}):`);
		for (const name of composeCovered.sort()) {
			console.log(`   ${name}`);
		}
	}

	if (optionalMissing.length > 0) {
		console.log(`\n  Optional / has defaults (${optionalMissing.length}):`);
		for (const name of optionalMissing.sort()) {
			console.log(`   ${name}`);
		}
	}

	// Missing — consumed but nowhere to be found
	if (missing.length > 0) {
		console.log(`\n  MISSING - consumed but not provided (${missing.length}):`);
		for (const name of missing.sort()) {
			// Show where it's consumed
			const locations = consumed
				.filter((u) => u.name === name)
				.map((u) => `${u.file}:${u.line}`);
			console.log(`   ${name}`);
			for (const loc of locations) {
				console.log(`     -> ${loc}`);
			}
		}
	}

	// Unused — in KeePass but never read
	if (unused.length > 0) {
		console.log(`\n  UNUSED - in KeePass but never consumed (${unused.length}):`);
		for (const name of unused.sort()) {
			console.log(`   ${name}`);
		}
	}

	// Ignored
	const ignoredEntries = Object.entries(svc.ignored);
	if (ignoredEntries.length > 0) {
		console.log(`\n  Ignored (${ignoredEntries.length}):`);
		for (const [name, reason] of ignoredEntries) {
			console.log(`   ${name} -- ${reason}`);
		}
	}

	if (missing.length === 0 && unused.length === 0) {
		console.log("\n  All clear!");
	}
}

// --- Main ---

const strict = process.argv.includes("--strict");
const debug = process.argv.includes("--debug");
const onlyIdx = process.argv.indexOf("--only");
const onlyName = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null;

const servicesToCheck = onlyName
	? SERVICES.filter((s) => s.group === onlyName)
	: SERVICES;

if (onlyName && servicesToCheck.length === 0) {
	console.error(
		`Unknown group: ${onlyName}. Available: ${SERVICES.map((s) => s.group).join(", ")}`,
	);
	process.exit(1);
}

let hasIssues = false;

for (const svc of servicesToCheck) {
	const report = checkService(svc, debug);
	printReport(report, svc);
	if (report.missing.length > 0 || report.unused.length > 0) {
		hasIssues = true;
	}
}

if (hasIssues && strict) {
	console.log(
		"\n  FAIL: --strict is set and there are missing or unused env vars.",
	);
	console.log(
		"  Fix the gaps or update the config in ci/check-env-coverage.ts\n",
	);
	process.exit(1);
}
