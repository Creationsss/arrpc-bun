import type { Activity } from "./activity.d.ts";

export interface SetActivityArgs {
	activity?: Activity | null;
	pid?: number;
}

export interface InviteArgs {
	code: string;
}

export interface DeepLinkArgs {
	type: string;
	params?: Record<string, unknown>;
}

export type RPCArgs =
	| SetActivityArgs
	| InviteArgs
	| DeepLinkArgs
	| Record<string, unknown>;

export interface RPCData {
	v?: number;
	config?: {
		cdn_host?: string;
		api_endpoint?: string;
		environment?: string;
	};
	user?: {
		id?: string;
		username?: string;
		discriminator?: string;
		global_name?: string;
		avatar?: string | null;
		avatar_decoration_data?: null;
		bot?: boolean;
		flags?: number;
		premium_type?: number;
	};
	code?: number | string;
	message?: string;
	[key: string]: unknown;
}

export interface RPCMessage {
	cmd: string;
	args?: RPCArgs;
	nonce?: string | null;
	evt?: string | null;
	data?: RPCData | Activity | null;
}
