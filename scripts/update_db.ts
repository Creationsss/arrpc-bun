import { write } from "bun";
import { print, printError } from "../src/logger";
import type { DetectableApp } from "../src/types";

print("Fetching detectable.json from Discord API...");

let current: DetectableApp[] = [];
try {
	const detectableDbRaw = await import("../detectable.json");
	current = detectableDbRaw.default as DetectableApp[];
} catch {
	print("No existing detectable.json found, starting fresh");
}

const response = await fetch(
	"https://discord.com/api/v9/applications/detectable",
);

if (!response.ok) {
	printError(`Failed to fetch detectable.json: HTTP ${response.status}`);
	process.exit(1);
}

const updated = (await response.json()) as DetectableApp[];
await write(
	new URL("../detectable.json", import.meta.url),
	JSON.stringify(updated, null, 2),
);

print("Updated detectable.json");
print(
	`  ${current.length} -> ${updated.length} games (+${updated.length - current.length})`,
);

const oldNames = current.map((x) => x.name);
const newNames = updated.map((x) => x.name);
const newGames = newNames.filter((x) => !oldNames.includes(x));

if (newGames.length > 0) {
	print(`  New games: ${newGames.slice(0, 5).join(", ")}`);
	if (newGames.length > 5) {
		print(`  ... and ${newGames.length - 5} more`);
	}
}

print("\nFetching detectable_fixes.json from upstream...");

let currentFixesData: Partial<DetectableApp>[] = [];
try {
	const detectableFixesDbRaw = await import("../detectable_fixes.json");
	currentFixesData = detectableFixesDbRaw.default as Partial<DetectableApp>[];
} catch {
	print("No existing detectable_fixes.json found, starting fresh");
}

const fixesResponse = await fetch(
	"https://gist.githubusercontent.com/Creationsss/2f25b7d76259b8fd2f23cf27cd538162/raw/detectable_fixes.json",
);

if (!fixesResponse.ok) {
	printError(
		`Failed to fetch detectable_fixes.json: HTTP ${fixesResponse.status}`,
	);
	print("Keeping existing detectable_fixes.json");
} else {
	const upstreamFixes =
		(await fixesResponse.json()) as Partial<DetectableApp>[];

	const upstreamIds = new Set(
		upstreamFixes
			.map((x) => x.id)
			.filter((id): id is string => Boolean(id)),
	);
	const localOnly = currentFixesData.filter(
		(x) => x.id && !upstreamIds.has(x.id),
	);
	const mergedFixes = [...upstreamFixes, ...localOnly];

	await write(
		new URL("../detectable_fixes.json", import.meta.url),
		JSON.stringify(mergedFixes, null, "\t"),
	);
	print("Updated detectable_fixes.json");
	print(
		`  ${currentFixesData.length} -> ${mergedFixes.length} entries (upstream: ${upstreamFixes.length}, local-only preserved: ${localOnly.length})`,
	);

	const oldFixIds = currentFixesData
		.map((x) => x.id)
		.filter((id): id is string => Boolean(id));
	const newFixes = [...upstreamIds].filter((x) => !oldFixIds.includes(x));

	if (newFixes.length > 0) {
		print(`  New upstream fixes: ${newFixes.join(", ")}`);
	}
	if (localOnly.length > 0) {
		const localIds = localOnly
			.map((x) => x.id)
			.filter((id): id is string => Boolean(id));
		print(`  Preserved local fixes: ${localIds.join(", ")}`);
	}
}

print("\nDatabase update complete!");
