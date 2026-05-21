import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "bun";
import { DARWIN_APP_BOUNDARY_REGEX, isSteamPath } from "../../constants";
import type { ProcessInfo } from "../../types";
import { resolveSteamApp } from "../steam";

const winExePathRegex =
	/((?:(?:[a-zA-Z]:|\\\\[\w\s.]+\\[\w\s.$]+)\\(?:[\w\s.]+\\)*)(?:[\w\s.]*?)\.exe)/;
const parallelsDir = resolve(homedir(), "Applications (Parallels)");

function parseCommandLine(cmdline: string): { exe: string; args: string[] } {
	const appMatch = cmdline.match(DARWIN_APP_BOUNDARY_REGEX);
	const appIndex = appMatch?.index ?? -1;
	if (appIndex !== -1) {
		let pathEnd = appIndex + 4;

		if (cmdline.substring(pathEnd).startsWith("/Contents/MacOS/")) {
			const contentsMacosStart = pathEnd + "/Contents/MacOS/".length;
			let foundArgStart = false;

			for (let i = contentsMacosStart; i < cmdline.length; i++) {
				if (cmdline[i] === " ") {
					const nextNonSpace = cmdline.substring(i).trim();
					if (
						nextNonSpace.startsWith("-") ||
						nextNonSpace.startsWith("+") ||
						nextNonSpace === ""
					) {
						pathEnd = i;
						foundArgStart = true;
						break;
					}
				}
			}

			if (!foundArgStart) {
				pathEnd = cmdline.length;
			}
		}

		let appPath = cmdline.substring(0, appIndex + 4);
		const restOfLine = cmdline.substring(pathEnd).trim();
		const args = restOfLine ? restOfLine.split(/\s+/) : [];

		if (appPath.startsWith(parallelsDir)) {
			if (appPath.endsWith(".exe.app")) {
				appPath = appPath.replace(".app", "");
			} else {
				appPath += "_name";
			}
		}

		return { exe: appPath, args };
	}

	if (winExePathRegex.test(cmdline)) {
		const exePath = cmdline.match(winExePathRegex)?.[0];
		if (exePath) {
			const exePathIdx = cmdline.indexOf(exePath);
			const restOfLine = cmdline
				.substring(exePathIdx + exePath.length)
				.trim();
			const args = restOfLine ? restOfLine.split(/\s+/) : [];
			return { exe: exePath, args };
		}
	}

	const parts = cmdline.split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		return { exe: "", args: [] };
	}

	const exe = parts[0] as string;
	const args = parts.slice(1);

	return { exe, args };
}

export async function getProcesses(): Promise<ProcessInfo[]> {
	try {
		const proc = spawn(["ps", "-awwxo", "pid=,args="]);
		const output = await new Response(proc.stdout).text();
		const lines = output.split("\n");

		const processes: ProcessInfo[] = [];

		for (const line of lines) {
			const trimmedLine = line.trim();
			if (!trimmedLine) continue;

			const firstSpaceIndex = trimmedLine.indexOf(" ");
			if (firstSpaceIndex === -1) continue;

			const pidNum = Number.parseInt(
				trimmedLine.substring(0, firstSpaceIndex),
				10,
			);
			const cmdline = trimmedLine.substring(firstSpaceIndex).trim();

			if (Number.isNaN(pidNum) || pidNum <= 0) continue;

			if (
				!cmdline ||
				cmdline.startsWith("[") ||
				cmdline.startsWith("<")
			) {
				continue;
			}

			const { exe, args } = parseCommandLine(cmdline);

			if (!exe) continue;

			const exeLower = exe.toLowerCase();
			const steamPath = isSteamPath(exeLower)
				? await resolveSteamApp(exe)
				: null;
			const finalPath = steamPath ?? exe;

			processes.push([pidNum, finalPath, args]);
		}

		return processes;
	} catch {
		return [];
	}
}
