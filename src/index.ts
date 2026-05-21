import { env } from "bun";
import {
	init as initBridge,
	request as requestFromBridge,
	send as sendToBridge,
} from "./bridge";
import { listDatabase, listDetected } from "./cli";
import {
	CLI_ARG_LIST_DATABASE,
	CLI_ARG_LIST_DETECTED,
	DEFAULT_VERSION,
	ENV_DEBUG,
	ENV_IGNORE_LIST_FILE,
	ENV_PARENT_MONITOR,
	ENV_STATE_FILE,
} from "./constants";
import { ignoreList } from "./ignore-list";
import Server from "./server";
import { stateManager } from "./state";
import { logger as log } from "./utils";

let version = DEFAULT_VERSION;
try {
	const pkg = await import("../package.json", { with: { type: "json" } });
	version = pkg.default.version;
} catch {
	version = DEFAULT_VERSION;
}

if (process.argv.includes(CLI_ARG_LIST_DATABASE)) {
	await listDatabase();
	process.exit(0);
}

if (process.argv.includes(CLI_ARG_LIST_DETECTED)) {
	await listDetected();
	process.exit(0);
}

log.info(`arRPC-Bun v${version}`);
stateManager.setAppVersion(version);
stateManager.initialize();

const ignoreListFile = env[ENV_IGNORE_LIST_FILE];
if (ignoreListFile) {
	await ignoreList.initialize(ignoreListFile);
	log.info(`ignore list enabled with file: ${ignoreListFile}`);
} else {
	await ignoreList.initialize();
}

await initBridge();

const server = await Server.create();

server.on("activity", (data) => {
	if (env[ENV_DEBUG]) {
		log.info("activity event received, forwarding to bridge:", data);
	}
	sendToBridge(data);
	if (env[ENV_STATE_FILE]) {
		stateManager.update(data);
	}
});

server.on("invite", (code: string, callback: (ok: boolean) => void) => {
	requestFromBridge("INVITE", { code }, callback);
});

server.on("guild-template", (code: string, callback: (ok: boolean) => void) => {
	requestFromBridge("GUILD_TEMPLATE", { code }, callback);
});

server.on("link", (data: unknown, callback: (ok: boolean) => void) => {
	requestFromBridge("LINK", data, callback);
});

if (env[ENV_PARENT_MONITOR]) {
	const initialParentPid = process.ppid;
	let shutdownTriggered = false;

	const handleParentDeath = () => {
		if (shutdownTriggered) return;
		shutdownTriggered = true;
		log.info("parent process died, shutting down");
		shutdown();
	};

	process.stdout.on("error", (err) => {
		if ((err as NodeJS.ErrnoException).code === "EPIPE") {
			handleParentDeath();
		}
	});

	process.stderr.on("error", (err) => {
		if ((err as NodeJS.ErrnoException).code === "EPIPE") {
			handleParentDeath();
		}
	});

	const parentMonitor = setInterval(() => {
		if (shutdownTriggered) {
			clearInterval(parentMonitor);
			return;
		}

		const currentParentPid = process.ppid;
		if (currentParentPid !== initialParentPid) {
			log.info(
				`parent process changed from ${initialParentPid} to ${currentParentPid}, shutting down`,
			);
			clearInterval(parentMonitor);
			handleParentDeath();
			return;
		}

		try {
			process.kill(initialParentPid, 0);
		} catch {
			log.info(
				`parent process ${initialParentPid} no longer exists, shutting down`,
			);
			clearInterval(parentMonitor);
			handleParentDeath();
		}
	}, 2000);
}

const shutdown = () => {
	log.info("received shutdown signal");
	stateManager.cleanup();
	server.shutdown();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
