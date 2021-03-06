import buffer from 'buffer';

import {BoundClass} from '../lib/util';
import Connection from './connection';
import IPCHandler from './ipc';
import Storage from './storage';
import * as promiseUtil from '../lib/promise';
import common from '../lib/common';
import windows from '../lib/windows';

class ipcMethods extends BoundClass {
	constructor(page) {
		super();

		this.page = page;
	}

	getRoster() {
		return this.page.getRoster();
	}

	isAuthed() {
		if(this.page.requiresAuth === undefined) {
			return null;
		}

		return !this.page.requiresAuth;
	}

	chatOpened(connection, jid) {
		return this.page.conversationOpened(jid);
	}

	authenticate(connection, jid, password) {
		this.page.authenticate(jid, password);
	}

	getMessageHistory(connection, jid) {
		return this.page.getMessageHistory(jid/*, 50*/);
	}

	sendMessage(connection, jid, message) {
		return this.page.sendMessage(jid, message);
	}
}

class NotificationHandler {
	constructor(backgroundPage) {
		super();

		chrome.notifications.onClicked.addListener(this.notificationClicked.bind(this));
		chrome.notifications.onClosed.addListener(this.notificationClosed.bind(this));

		this.page = backgroundPage;
	}

	notificationClosed(id, byUser) {
		if(!byUser) return;
		if(!id.startsWith("conversation:")) return;

		var jid = id.substr(13);

		this.page.storagePromise.then(() => {
			return this.page.storage.touchConversationViewed(jid).then((conversation) => {
				return this.updateConversationNotification(jid, undefined, conversation[0]);
			});
		});
	}

	notificationClicked(id) {
		if(!id.startsWith("conversation:")) return;

		var jid = id.substr(13);

		windows.chat(jid);
	}

	updateConversationNotification(jid, rosterItem=undefined, conversation=undefined) {
		if(!rosterItem) rosterItem = this.page.storage.getRosterItem(jid);
		else rosterItem = Promise.resolve(rosterItem);

		if(!conversation) conversation = this.page.storage.getConversation(jid);
		else conversation = Promise.resolve(conversation);

		return Promise.all([rosterItem, conversation]).then(([rosterItem, conversation]) => {
			var name, avatarID;
			if(!rosterItem) {
				name = Promise.resolve(jid.split("@", 1)[0]);
				avatarID = undefined;
			} else {
				name = Promise.resolve(common.displayName(rosterItem));
				avatarID = rosterItem.avatar;
			}

			var avatarPromise;
			if(!avatarID) {
				avatarPromise = Promise.resolve(undefined);
			} else {
				avatarPromise = this.page.storage.getAvatarURL(avatarID);
			}

			var lastViewed;
			if(conversation && conversation.lastViewed) lastViewed = conversation.lastViewed;

			if(!lastViewed) {
				return Promise.all([name, this.page.storage.getMessages(jid, 10, true), avatarPromise]);
			}

			return Promise.all([name, this.page.storage.getMessagesSince(jid, lastViewed, 10, true), avatarPromise]);
		}).then(([name, messages, avatarUrl]) => {
			if(!avatarUrl) avatarUrl = "icons/icon-128.png";

			if(messages.length == 0) {
				return new Promise((resolve, reject) => {
					chrome.notifications.clear(`conversation:${jid}`, resolve);
				});
			}

			var items = [];
			for(var i = 0, iLen = messages.length; i < iLen; i++) {
				var message = messages[i];

				items.push({
					title: "",
					message: message.body
				});
			}

			var eventTime = messages[messages.length-1].time;

			return new Promise((resolve, reject) => {
				chrome.notifications.create(`conversation:${jid}`, {
					type: "list",
					isClickable: true,

					iconUrl: avatarUrl,
					title: name,
					eventTime: eventTime,

					message: "",
					items: items
				}, resolve);
			});
		});
	}
}

const avatarTypeWhitelist = {
	'image/png': true,
	'image/gif': true,
	'image/jpeg': true,
	'image/webp': true,
	'image/svg+xml': true,
	'image/bmp': true
};

class BackgroundPage {
	constructor() {
		super();

		chrome.browserAction.onClicked.addListener(this.browserActionClicked.bind(this));
		chrome.runtime.onInstalled.addListener(this.onInstalled.bind(this));

		this.ipcHandler = new IPCHandler(new ipcMethods(this));

		this.notificationHandler = new NotificationHandler(this);

		this.storage = new Storage();
		this.storagePromise = new Promise((resolve, reject) => {
			this.storage.once('ready', () => resolve());
		});

		this.createClient();
	}

	createClient() {
		return this.storagePromise.then(() => {
			return promiseUtil.map({
				credentials: this.storage.getSetting('credentials'),
				rosterVersion: this.storage.getSetting('rosterVersion')
			}).then(this.initialStorageRetrieve.bind(this));
		});
	}

	authenticate(jid, password) {
		console.debug('Received authenticate request. Removing existing authentication data.');

		if(this.client) {
			console.debug('Stopping client...');
			this.client.stop();
			delete this.client;
		}

		return this.storagePromise.then(() => {
			return this.storage.clear().then(this.authenticate_.bind(this, jid, password));
		});
	}

	authenticate_(jid, password) {
		console.debug('Starting new client...');
		this.createClient_({
			jid: jid,
			password: password
		});
	}

	createClient_(credentials, rosterVersion) {
		if(this.client) {
			this.client.stop();
			delete this.client;
		}

		this.client = new Connection(credentials, rosterVersion);

		this.client.on('credentialsUpdated', this.credentialsUpdated.bind(this));
		this.client.on('roster:update', this.rosterUpdated.bind(this, true));
		this.client.on('roster:remove', this.rosterUpdated.bind(this, false));
		this.client.on('roster:version', this.newRosterVersion.bind(this));
		this.client.on('roster:received', this.rosterReceived.bind(this));
		this.client.on('avatar:list', this.avatarListReceived.bind(this));
		this.client.on('message', this.handleMessage.bind(this));
		this.client.on('authResult', this.authResult.bind(this));

		this.client.start();
	}

	getRoster() {
		return this.storagePromise.then(() => {
			return this.storage.getRosterItems().then(this.fetchRosterAvatars_.bind(this));
		});
	}

	sendMessage(jid, message) {
		if(this.client === undefined) {
			return false;
		}

		this.client.sendMessage(jid, message);
		return true;
	}

	browserActionClicked() {
		if(this.requiresAuth === true) {
			windows.signIn();
			return;
		}
		windows.roster();
	}

	credentialsUpdated(credentials) {
		this.storagePromise.then(() => {
			return this.storage.setSetting('credentials', credentials);
		});
	}

	fetchRosterAvatars_(rosterItems) {
		var promises = new Array(rosterItems.length);

		for(var i = 0; i < rosterItems.length; i++) {
			var rosterItem = rosterItems[i];

			if(!rosterItem.avatar) {
				delete rosterItem.avatar;
				promises[i] = Promise.resolve();
				continue;
			}

			promises[i] = this.storage.getAvatarURL(rosterItem.avatar);
		}

		return Promise.all(promises).then((avatarURLs) => {
			for(var i = 0; i < avatarURLs.length; i++) {
				var avatarURL = avatarURLs[i];
				if(!avatarURL) continue;

				rosterItems[i].avatar = avatarURL;
			}

			return rosterItems;
		});
	}

	broadcastNewRoster_() {
		return this.storagePromise.then(() => {
			return this.storage.getRosterItems().then(this.fetchRosterAvatars_.bind(this)).then((rosterItems) => {
				this.ipcHandler.broadcast('roster', 'rosterUpdated', rosterItems);
			});
		});
	}

	rosterUpdated(add, rosterItem) {
		if(!add) {
			this.storagePromise.then(() => {
				this.storage.getRosterItem(rosterItem).then((rosterItem) => {
					if(rosterItem.avatar) {
						this.storage.removeAvatar(rosterItem.avatar);
					}

					return this.storage.removeRosterItem(rosterItem).then(this.broadcastNewRoster_.bind(this));
				});
			});
			return;
		}

		this.storagePromise.then(() => {
			this.storage.getRosterItem(rosterItem.jid).then((oldRosterItem) => {
				if(oldRosterItem) rosterItem.avatar = oldRosterItem.avatar;

				return this.storage.setRosterItem(rosterItem).then(this.broadcastNewRoster_.bind(this));
			});
		});
	}

	newRosterVersion(version) {
		this.storagePromise.then(() => {
			return this.storage.setSetting('rosterVersion', version);
		});
	}

	rosterReceived() {
		this.storagePromise.then(() => {
			return this.storage.getRosterItems();
		}).then((rosterItems) => {
			for(var i = 0, iLen = rosterItems.length; i < iLen; i++) {
				var rosterItem = rosterItems[i];
				this.notificationHandler.updateConversationNotification(rosterItem.jid, rosterItem);
			}
		});
	}

	pickFavoredAvatar(avatars) {
		// Grab the first avatar that fits our image whitelist.
		for(var i = 0, iLen = avatars.length; i < iLen; i++) {
			var avatar = avatars[i];

			if(!avatarTypeWhitelist[avatar.mimeType]) continue;

			return avatar;
		}
	}

	avatarListReceived(jid, avatars) {
		console.info('Avatar list for', jid, 'received:', avatars);

		this.storagePromise.then(() => {
			return this.storage.getRosterItem(jid);
		}).then((rosterItem) => {
			if(!rosterItem) return; // We don't store avatars for people not on our roster.

			var avatar = this.pickFavoredAvatar(avatars);
			if(rosterItem.avatar === avatar.id) return; // We already have the latest avatar for this person

			this.client.fetchAvatar(rosterItem.jid, avatar).then((avatarBlob) => {
				var deletePromise = Promise.resolve();
				if(rosterItem.avatar && rosterItem.avatar !== avatar.id) {
					deletePromise = this.storage.removeAvatar(rosterItem.avatar);
					delete rosterItem.avatar;
				}

				Promise.all([deletePromise, this.storage.addAvatar(avatar.id, avatarBlob)]).then(() => {
					return this.storage.setRosterAvatar(rosterItem.jid, avatar.id);
				}).then(() => {
					console.debug(arguments);
					console.info('New avatar for', rosterItem.jid, avatar.id);
				});
			});
		});
	}

	getMessageHistory(jid, limit) {
		return this.storagePromise.then(() => {
			return this.storage.getMessages(jid, limit);
		});
	}

	handleMessage(msg) {
		var jid = msg.incoming ? msg.from : msg.to;

		var chatWindowPromise = new Promise((resolve, reject) => {
			windows.findChat(jid, resolve);
		});

		this.storagePromise.then(() => {
			return this.storage.addMessage(msg).then((msgID) => {
				return Promise.all([this.getMessageHistory(jid), this.storage.touchConversationMessage(jid, msg.time), chatWindowPromise]).then(([messages, [conversation], chatWindow]) => {
					this.ipcHandler.broadcast('messages:'+jid, 'messagesUpdated', messages);

					if(chatWindow && chatWindow.focused) {
						conversation.lastViewed = Date.now();
						this.storage.touchConversationViewed(jid);
					}

					return this.notificationHandler.updateConversationNotification(jid, undefined, conversation);
				});
			});
		});
	}

	conversationOpened(jid) {
		return this.storagePromise.then(() => {
			return this.storage.touchConversationViewed(jid).then((conversation) => {
				return this.notificationHandler.updateConversationNotification(jid, undefined, conversation[0]);
			});
		});
	}

	authResult(success) {
		this.requiresAuth = !success;
		this.ipcHandler.broadcast('auth', 'authUpdated', success);
	}

	onInstalled(info) {
		if(info.reason === 'install') {
			this.browserActionClicked();
		}
	}

	initialStorageRetrieve(objects) {
		if(objects.credentials) {
			for(var propertyName in objects.credentials) {
				if(!objects.credentials.hasOwnProperty(propertyName)) {
					continue;
				}

				var property = objects.credentials[propertyName];
				if(!(property instanceof Uint8Array)) {
					continue;
				}

				objects.credentials[propertyName] = buffer.Buffer(property, property.length, 0);
			}
		}

		if(!objects.credentials) {
			this.requiresAuth = true;
			this.ipcHandler.broadcast('auth', 'authUpdated', !this.requiresAuth);
			return;
		}

		this.createClient_(objects.credentials, objects.rosterVersion);
	}
}

export default BackgroundPage;
