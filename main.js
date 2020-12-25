// @ts-nocheck
"use strict";

/*
 * Created with @iobroker/create-adapter v1.31.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

// Load your modules here, e.g.:
// const fs = require("fs");

//axios with cookie support for iobroker
//https://github.com/3846masa/axios-cookiejar-support#usage
const axios = require('axios').default;
const axiosCookieJarSupport = require('axios-cookiejar-support').default;
const tough = require('tough-cookie');
axiosCookieJarSupport(axios);
const cookieJar = new tough.CookieJar();

var changeInProgress = false;

class RikaFirenet extends utils.Adapter {

	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: "rika-firenet",
		});

		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		this.on("objectChange", this.onObjectChange.bind(this));
		// this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));
		
		//init timeout for recursive call webLogin() or getstoveValues()
		this.TimeoutID = null;
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here

		// Reset the connection indicator during startup
		this.setState("info.connection", false, true);

		// The adapters config (in the instance object everything under the attribute "native") is accessible via
		// this.config:
		//log some of the config attributes
		this.log.info("config user: " + this.config.myuser);
		this.log.info("config interval: " + this.config.myinterval);
		this.log.info("config stoveid: " + this.config.mystoveid);

		//create device
		await this.setObjectNotExistsAsync(this.config.mystoveid, {
			type: "device",
			common: {
				name: this.config.mystoveid,
			},
			native: {},
		});

		//call weblogin
		await this.webLogin();
		
		//create some static objects and subscribe
		this.setStoveStates("name", "state", "", false, false, "");
		this.setStoveStates("stoveID", "state", "", false, false, 0);
		this.setStoveStates("lastSeenMinutes", "state", "", false, false, 0);
		this.setStoveStates("lastConfirmedRevision", "state", "", false, false, 0);
		this.setStoveStates("stoveType", "state", "", false, false, "");
		this.setStoveStates("oem", "state", "", false, false, "");

		//create static channels and subscribe
		this.setStoveStates("controls", "channel", "", false, false, "");
		this.setStoveStates("sensors", "channel", "", false, false, "");
		this.setStoveStates("stoveFeatures", "channel", "", false, false, "");

	}

	async webLogin() {
		clearTimeout(this.TimeoutID);

		var email = this.config.myuser;
		var password = this.config.mypassword;
		var apiserver = 'https://www.rika-firenet.com';

		try {
			const response = await axios.post(apiserver + '/web/login', { email, password }, { jar: cookieJar, withCredentials: true });
			// in response steht jetzt die Antwort
			// wenn man sie außerhalb der Funktion nutzen will:
			// return response; // oder einen Teil davon
			this.setState("info.connection", true, true);
			this.log.info('webLogin OK')
			
			//call getstoveValues, if successfully webLogin 
			await this.getstoveValues();
		} catch (e) {
			this.setState("info.connection", false, true);
			this.log.error('webLogin failed: ' + e.message);
			
			//call webLogin() again in 1 minute, till sucessfully login
			clearTimeout(this.TimeoutID);
			this.TimeoutID = setTimeout(() => this.webLogin(), this.config.myinterval * 60000);
		}
	}

	async getstoveValues() {
		if (changeInProgress == false) {

			var stoveID = this.config.mystoveid;
			var apiserver = 'https://www.rika-firenet.com';

			try {
				const response2 = await axios.get(apiserver + '/api/client/' + stoveID + '/status', { jar: cookieJar, withCredentials: true })
				// in response steht jetzt die Antwort
				// wenn man sie außerhalb der Funktion nutzen will:
				// return response; // oder einen Teil davon

				//output json to log
				//this.log.info(JSON.stringify(response2.data));

				//load json into content
				const content = response2.data;

				//testoutput, if correct data come in
				//this.log.info("lastConfirmedRevision: " + content.lastConfirmedRevision);

				//set states if correct data come in
				if (content.lastConfirmedRevision) {
					this.setState(this.config.mystoveid + ".name", { val: content.name, ack: true });
					this.setState(this.config.mystoveid + ".stoveID", { val: content.stoveID, ack: true });
					this.setState(this.config.mystoveid + ".lastSeenMinutes", { val: content.lastSeenMinutes, ack: true });
					this.setState(this.config.mystoveid + ".lastConfirmedRevision", { val: content.lastConfirmedRevision, ack: true });
					this.setState(this.config.mystoveid + ".stoveType", { val: content.stoveType, ack: true });
					this.setState(this.config.mystoveid + ".oem", { val: content.oem, ack: true });

					//create and/or update states in controls, sensors and stoveFeatures
					for (let [key, value] of Object.entries(content.controls)) {
						this.setStoveStates(`controls.${key}`, "state", "", true, true, value);
					}	
					for (let [key, value] of Object.entries(content.sensors)) {
						this.setStoveStates(`sensors.${key}`, "state", "", true, false, value);
					}
					for (let [key, value] of Object.entries(content.stoveFeatures)) {
						this.setStoveStates(`stoveFeatures.${key}`, "state", "", true, false, value);
					}
				} else {
					this.log.error("Malformed json: " + JSON.stringify(response2.data));
				}

				//call getstoveValues() every 1 minute
				//https://blog.scottlogic.com/2017/09/14/asynchronous-recursion.html
				clearTimeout(this.TimeoutID);
				this.TimeoutID = setTimeout(() => this.getstoveValues(), this.config.myinterval * 60000);
			} catch (e) {
				this.setState("info.connection", false, true);
				this.log.error('getstoveValues: ' + e.message);
				this.log.error('try again in (minutes): ' + this.config.myinterval);

				//if connection to API fails, cycle webLogin(), till sucessfully login
				clearTimeout(this.TimeoutID);
				this.TimeoutID = setTimeout(() => this.webLogin(), this.config.myinterval * 60000);
			}	
		} else {
			this.log.info('change in progress: try to getstoveValues() next time');
		}
	}

	async setstoveValues(controlname, controlvalue) {
		//set true, to not run getstoveValues() at this time
		changeInProgress = true;

		var stoveID = this.config.mystoveid;
		var apiserver = 'https://www.rika-firenet.com';

		try {
			//get current json
			const response1 = await axios.get(apiserver + '/api/client/' + stoveID + '/status', { jar: cookieJar, withCredentials: true })
			const content = response1.data;

			//kick out adaptername, id, device and other stuff from string
			const cleanControlname = controlname.split('.').slice(4).join('.');
			this.log.info(cleanControlname + " = " + controlvalue);

			//change value in content.controls
			content.controls[cleanControlname] = controlvalue;

			//send modified json to server (todo: make shure, that only one action at the same time is fired up in Blockly)
			const response2 = await axios.post(apiserver + '/api/client/' + stoveID + '/controls', content.controls, { jar: cookieJar, withCredentials: true })	
			
		} catch (e) {
			this.log.error('setstoveValues: ' + e.message);
		}
		//set free
		changeInProgress = false;
	}

	/**
	 * @param {any} stateNameStr
	 * @param {any} stateRoleStr
	 * @param {any} stateReadBool
	 * @param {any} stateWriteBool
	 * @param {any} stateValueMix
	 * @param {string} stateTypeStr
	 */
	setStoveStates(stateNameStr, stateTypeStr, stateRoleStr, stateReadBool, stateWriteBool, stateValueMix){

		//...Datenpunkte mit richtigem Datentyp anlegen, wenn nicht existieren und Wert reinschreiben
		this.setObjectNotExists(this.config.mystoveid + "." + stateNameStr, {
			type: stateTypeStr,
			common: {
				name: stateNameStr,
				type: typeof stateValueMix,
				role: stateRoleStr,
				read: stateReadBool,
				write: stateWriteBool,
			},
				native: {},
			});
										 
			//subscribe states
			this.subscribeStates(this.config.mystoveid + "." + stateNameStr);

			//set states
			this.setState(this.config.mystoveid + "." + stateNameStr, { val: stateValueMix, ack: true });
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			// clearTimeout(timeout1);
			// clearTimeout(timeout2);
			// ...
			// clearInterval(interval1);
			//clearTimeout(this.TimeoutID);
			clearTimeout(this.TimeoutID);

			callback();
		} catch (e) {
			callback();
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	/**
	 * Is called if a subscribed object changes
	 * @param {string} id
	 * @param {ioBroker.Object | null | undefined} obj
	 */
	onObjectChange(id, obj) {
		if (obj) {
			// The object was changed
			this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
		} else {
			// The object was deleted
			this.log.info(`object ${id} deleted`);
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (state && !state.ack) {
		//if (state) {
			// The state was changed
			this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
			this.setstoveValues(id, state.val);
		} //else {
			// The state was deleted
			//this.log.info(`state ${id} deleted`);
		//}
	}

	// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.messagebox" property to be set to true in io-package.json
	//  * @param {ioBroker.Message} obj
	//  */
	// onMessage(obj) {
	// 	if (typeof obj === "object" && obj.message) {
	// 		if (obj.command === "send") {
	// 			// e.g. send email or pushover or whatever
	// 			this.log.info("send command");

	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
	// 		}
	// 	}
	// }

}

// @ts-ignore parent is a valid property on module
if (module.parent) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new RikaFirenet(options);
} else {
	// otherwise start the instance directly
	new RikaFirenet();
}