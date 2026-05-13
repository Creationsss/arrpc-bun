export interface BridgeMessage {
	type: string;
	nonce?: string;
	data?: { games?: string[] } & Record<string, unknown>;
}

export type BridgeRequestType = "INVITE" | "GUILD_TEMPLATE" | "LINK";
export type BridgeAckType = `ACK_${BridgeRequestType}`;

export interface BridgeRequest {
	type: BridgeRequestType;
	nonce: string;
	data: unknown;
}

export interface BridgeAck {
	type: BridgeAckType;
	nonce: string;
	data: boolean;
}
