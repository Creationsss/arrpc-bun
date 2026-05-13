export interface User {
	id: string;
	username: string;
	discriminator: string;
	global_name: string;
	avatar: string | null;
	avatar_decoration_data: null;
	bot: boolean;
	flags: number;
	premium_type: number;
}
