export function normalizeInstallComparePath(processPath: string): string {
	let normalized = processPath;

	if (processPath.startsWith("Z:\\") || processPath.startsWith("z:\\")) {
		normalized = processPath.substring(2).replaceAll("\\", "/");
	}

	if (process.platform === "win32") {
		normalized = normalized.replaceAll("/", "\\").toLowerCase();
	}

	return normalized;
}

export function findByInstallPath<T>(
	lookup: Map<string, T>,
	normalizedPath: string,
): { installPath: string; value: T } | null {
	const separator = process.platform === "win32" ? "\\" : "/";

	for (const [installPath, value] of lookup) {
		const compare =
			process.platform === "win32"
				? installPath.toLowerCase()
				: installPath;

		if (
			normalizedPath === compare ||
			normalizedPath.startsWith(compare + separator)
		) {
			return { installPath, value };
		}
	}

	return null;
}
