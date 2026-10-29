import { dlopen, FFIType, type Pointer, suffix } from "bun:ffi";
import { PROCESS_COLOR, SYSTEM_EXECUTABLES } from "../../constants";
import type { ProcessInfo } from "../../types";
import { createLogger } from "../../utils";
import { resolveProcessPath } from "../resolve";
import { isSteamObserverEnabled } from "../steam";

const log = createLogger("process:win32", ...PROCESS_COLOR);

const TH32CS_SNAPPROCESS = 0x00000002;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_VM_READ = 0x0010;
const MAX_PATH = 260;
const ProcessCommandLineInformation = 60;
const PROCESSENTRY32W_SIZE = 568;

const kernel32 = dlopen(`kernel32.${suffix}`, {
	CreateToolhelp32Snapshot: {
		args: [FFIType.u32, FFIType.u32],
		returns: FFIType.ptr,
	},
	Process32FirstW: {
		args: [FFIType.ptr, FFIType.ptr],
		returns: FFIType.bool,
	},
	Process32NextW: {
		args: [FFIType.ptr, FFIType.ptr],
		returns: FFIType.bool,
	},
	OpenProcess: {
		args: [FFIType.u32, FFIType.bool, FFIType.u32],
		returns: FFIType.ptr,
	},
	QueryFullProcessImageNameW: {
		args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
		returns: FFIType.bool,
	},
	CloseHandle: {
		args: [FFIType.ptr],
		returns: FFIType.bool,
	},
	GetLastError: {
		args: [],
		returns: FFIType.u32,
	},
});

const ntdll = dlopen(`ntdll.${suffix}`, {
	NtQueryInformationProcess: {
		args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr],
		returns: FFIType.i32,
	},
});

const pathBuffer = new Uint8Array(MAX_PATH * 2);
const sizeBuffer = new Uint32Array([MAX_PATH]);
const cmdLineInfoBuffer = new Uint8Array(8192);
const returnLength = new Uint32Array(1);

// @ts-expect-error utf-16le is supported by Bun but not in TS lib types
const utf16Decoder = new TextDecoder("utf-16le");

const failedOpens = new Set<number>();

function readWideString(
	buffer: Uint8Array,
	offset = 0,
	maxLength = MAX_PATH,
): string {
	let end = offset;
	const maxEnd = Math.min(buffer.length - 1, offset + maxLength * 2);
	while (end < maxEnd) {
		if (buffer[end] === 0 && buffer[end + 1] === 0) break;
		end += 2;
	}

	if (end > offset) {
		const slice = buffer.slice(offset, end);
		return utf16Decoder.decode(slice);
	}
	return "";
}

function readDWORD(buffer: Uint8Array, offset: number): number {
	return (
		(buffer[offset] || 0) |
		((buffer[offset + 1] || 0) << 8) |
		((buffer[offset + 2] || 0) << 16) |
		((buffer[offset + 3] || 0) << 24)
	);
}

function writeDWORD(buffer: Uint8Array, offset: number, value: number): void {
	buffer[offset] = value & 0xff;
	buffer[offset + 1] = (value >> 8) & 0xff;
	buffer[offset + 2] = (value >> 16) & 0xff;
	buffer[offset + 3] = (value >> 24) & 0xff;
}

function getProcessPath(hProcess: Pointer): string | null {
	try {
		sizeBuffer[0] = MAX_PATH;

		const result = kernel32.symbols.QueryFullProcessImageNameW(
			hProcess,
			0,
			pathBuffer as unknown as Pointer,
			sizeBuffer as unknown as Pointer,
		);

		if (result) {
			return readWideString(pathBuffer);
		}
	} catch {}
	return null;
}

function getProcessCommandLine(hProcess: Pointer): string[] {
	try {
		const status = ntdll.symbols.NtQueryInformationProcess(
			hProcess,
			ProcessCommandLineInformation,
			cmdLineInfoBuffer as unknown as Pointer,
			cmdLineInfoBuffer.length,
			returnLength as unknown as Pointer,
		);

		if (status === 0) {
			const length = readDWORD(cmdLineInfoBuffer, 0) & 0xffff;
			if (length > 0 && length < cmdLineInfoBuffer.length) {
				const cmdLine = readWideString(
					cmdLineInfoBuffer,
					16,
					length / 2,
				);
				if (cmdLine) {
					return parseCommandLine(cmdLine);
				}
			}
		}
	} catch {}
	return [];
}

function parseCommandLine(cmdLine: string): string[] {
	const args: string[] = [];
	const currentChars: string[] = [];
	let inQuotes = false;
	let i = 0;

	while (i < cmdLine.length) {
		const char = cmdLine[i] || "";

		if (char === '"') {
			inQuotes = !inQuotes;
			i++;
			continue;
		}

		if (char === " " && !inQuotes) {
			if (currentChars.length > 0) {
				args.push(currentChars.join(""));
				currentChars.length = 0;
			}
			i++;
			continue;
		}

		if (char === "\\") {
			let numBackslashes = 0;
			while (i < cmdLine.length && cmdLine[i] === "\\") {
				numBackslashes++;
				i++;
			}

			if (i < cmdLine.length && cmdLine[i] === '"') {
				const halfBackslashes = Math.floor(numBackslashes / 2);
				for (let j = 0; j < halfBackslashes; j++) {
					currentChars.push("\\");
				}
				if (numBackslashes % 2 === 0) {
					inQuotes = !inQuotes;
					i++;
				} else {
					currentChars.push('"');
					i++;
				}
			} else {
				for (let j = 0; j < numBackslashes; j++) {
					currentChars.push("\\");
				}
			}
			continue;
		}

		currentChars.push(char);
		i++;
	}

	if (currentChars.length > 0) {
		args.push(currentChars.join(""));
	}

	return args;
}

export async function getProcesses(): Promise<ProcessInfo[]> {
	const processes: ProcessInfo[] = [];
	const observerEnabled = isSteamObserverEnabled();

	try {
		const hSnapshot = kernel32.symbols.CreateToolhelp32Snapshot(
			TH32CS_SNAPPROCESS,
			0,
		);

		if (!hSnapshot || hSnapshot === -1) {
			log.info(
				"failed to create process snapshot:",
				kernel32.symbols.GetLastError(),
			);
			return [];
		}

		try {
			const pe32 = new Uint8Array(PROCESSENTRY32W_SIZE);
			writeDWORD(pe32, 0, PROCESSENTRY32W_SIZE);

			let hasProcess = kernel32.symbols.Process32FirstW(
				hSnapshot,
				pe32 as unknown as Pointer,
			);

			let processCount = 0;
			const YIELD_INTERVAL = 20;
			const seenPids = new Set<number>();

			if (failedOpens.size > 1000) {
				failedOpens.clear();
			}

			while (hasProcess) {
				const pid = readDWORD(pe32, 8);
				const exeFile = readWideString(pe32, 44, 260);

				if (pid > 0 && exeFile) {
					if (pid <= 1000) {
						hasProcess = kernel32.symbols.Process32NextW(
							hSnapshot,
							pe32 as unknown as Pointer,
						);
						continue;
					}

					const exeFileLower = exeFile.toLowerCase();
					if (SYSTEM_EXECUTABLES.has(exeFileLower)) {
						hasProcess = kernel32.symbols.Process32NextW(
							hSnapshot,
							pe32 as unknown as Pointer,
						);
						continue;
					}

					seenPids.add(pid);

					if (failedOpens.has(pid)) {
						hasProcess = kernel32.symbols.Process32NextW(
							hSnapshot,
							pe32 as unknown as Pointer,
						);
						continue;
					}

					const hProcess = kernel32.symbols.OpenProcess(
						PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
						false,
						pid,
					);

					let fullPath = "";
					let args: string[] = [];

					if (hProcess && hProcess !== 0) {
						try {
							const path = getProcessPath(hProcess);
							if (path) {
								fullPath = path;
							}

							args = getProcessCommandLine(hProcess);
						} finally {
							kernel32.symbols.CloseHandle(hProcess);
						}
					} else {
						failedOpens.add(pid);
					}

					if (!fullPath) {
						fullPath = exeFile;
					}

					const resolved = await resolveProcessPath(
						fullPath,
						args,
						observerEnabled,
					);

					processes.push([pid, resolved.path, args, resolved.appid]);

					if (++processCount % YIELD_INTERVAL === 0) {
						await new Promise((r) => setImmediate(r));
					}
				}

				hasProcess = kernel32.symbols.Process32NextW(
					hSnapshot,
					pe32 as unknown as Pointer,
				);
			}

			for (const failedPid of failedOpens) {
				if (!seenPids.has(failedPid)) {
					failedOpens.delete(failedPid);
				}
			}
		} finally {
			kernel32.symbols.CloseHandle(hSnapshot);
		}
	} catch (error) {
		log.info("error enumerating processes:", error);
	}

	return processes;
}
