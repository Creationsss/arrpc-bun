import { PROCESS_COLOR, STEAM_SKU_DISTRIBUTOR } from "../constants";
import type { DetectableApp } from "../types";
import { createLogger } from "../utils";

const log = createLogger("steam-sku", ...PROCESS_COLOR);

const steamSkuIndex: Map<string, DetectableApp> = new Map();

export function buildSteamSkuIndex(db: DetectableApp[]): void {
	steamSkuIndex.clear();

	for (const app of db) {
		const skus = app.third_party_skus;
		if (!skus) continue;

		for (const sku of skus) {
			if (sku.distributor !== STEAM_SKU_DISTRIBUTOR) continue;
			if (!sku.id) continue;

			if (!steamSkuIndex.has(sku.id)) {
				steamSkuIndex.set(sku.id, app);
			}
		}
	}

	log.info("built Steam SKU index with", steamSkuIndex.size, "app ids");
}

export function lookupSteamApp(appid: string): DetectableApp | undefined {
	return steamSkuIndex.get(appid);
}
