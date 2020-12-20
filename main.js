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

// Save cookies to maintain logged in state
const request = require('request').defaults({jar: true});

//Interval for polling
this.TimeoutID = null;

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
		this.log.info("config user: " + this.config.myuser);
		//this.log.info("config password: " + this.config.mypassword);
		this.log.info("config interval: " + this.config.myinterval);
		this.log.info("config stoveid: " + this.config.mystoveid);

		//Create Device
		await this.setObjectNotExistsAsync(this.config.mystoveid, {
			type: "device",
			common: {
				name: this.config.mystoveid,
			},
			native: {},
		});

		//weblogin and getStoveValues
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

	//Eigenes Zeug
	webLogin () {
		clearTimeout(this.TimeoutID);

		require("request")
		request.post({url:'https://www.rika-firenet.com/web/login', form: {email:this.config.myuser, password:this.config.mypassword}}, (error, response, body) => {  	
				if (body.indexOf("summary") > -1) {// login successful

					this.log.info("Web-Login successful");
					this.setState("info.connection", true, true);

					//get values, if login successful
					this.getStoveValues();
				} else {//login failed

					this.log.error("Web-Login not successful");
					this.setState("info.connection", false, true);

					//cycle webLogin, till sucessfully login
					this.TimeoutID = setTimeout(this.webLogin.bind(this), this.config.myinterval * 60000);
				}
			})
		}

	getStoveValues() {
		request.get({url:'https://www.rika-firenet.com/api/client/' + this.config.mystoveid + '/status'}, (error, response, body) => {
			this.log.info(response.statusCode + " - API-Connection sucessful");
			if (response.statusCode == 200 && body.indexOf(this.config.mystoveid) > -1) {// request successful
				var json = JSON.parse(body);

				//set states only, if json has a lastConfirmedRevision, to prevent from creating malformed states in cases of db-errors in json
				if (json.lastConfirmedRevision) {

					this.setState(this.config.mystoveid + ".name", { val: json.name, ack: true });
					this.setState(this.config.mystoveid + ".stoveID", { val: json.stoveID, ack: true });
					this.setState(this.config.mystoveid + ".lastSeenMinutes", { val: json.lastSeenMinutes, ack: true });
					this.setState(this.config.mystoveid + ".lastConfirmedRevision", { val: json.lastConfirmedRevision, ack: true });
					this.setState(this.config.mystoveid + ".stoveType", { val: json.stoveType, ack: true });
					this.setState(this.config.mystoveid + ".oem", { val: json.oem, ack: true });
	
					//create and/or update states in controls, sensors and stoveFeatures
					for (let [key, value] of Object.entries(json.controls)) {
						this.setStoveStates(`controls.${key}`, "state", "", true, true, value);
					}
	
					for (let [key, value] of Object.entries(json.sensors)) {
						this.setStoveStates(`sensors.${key}`, "state", "", true, false, value);
					}
	
					for (let [key, value] of Object.entries(json.stoveFeatures)) {
						this.setStoveStates(`stoveFeatures.${key}`, "state", "", true, false, value);
					}
				} else {
					this.log.error("Malformed json: " + json);
				}
			} else {
				//if connection to API fails, cycle webLogin, till sucessfully login
				this.TimeoutID = setTimeout(this.webLogin.bind(this), this.config.myinterval * 60000);
			}
		})
		//call again every ... milliseconds
		clearTimeout(this.TimeoutID);
		this.TimeoutID = setTimeout(this.getStoveValues.bind(this), this.config.myinterval * 60000);
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
		if (state) {
			// The state was changed
			//this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
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