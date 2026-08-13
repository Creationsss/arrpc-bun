import { isSteamPath } from "../constants";
import { resolveLauncherApp } from "./launchers";
import { pickSteamAppId, resolveSteamProcess } from "./steam";

export async function resolveProcessPath(
	exePath: string,
	args: string[],
	observerEnabled: boolean,
): Promise<{ path: string; appid: string | undefined }> {
	const steam = isSteamPath(exePath.toLowerCase())
		? await resolveSteamProcess(exePath)
		: null;

	const appid = pickSteamAppId(steam?.appid, args, observerEnabled);

	if (steam) {
		return { path: steam.path, appid };
	}

	const launcher = await resolveLauncherApp(exePath);
	return { path: launcher ?? exePath, appid };
}
