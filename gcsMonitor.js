/**
 * @fileoverview Class for retrieving data on Google Cloud storage.  Executes as a Cloud Function with
 * a storage trigger.
 * @author Joey Whelan <joey.whelan@gmail.com>
 */

/*jshint esversion: 6 */

'use strict';
'use esversion 6';

const csv = require('csvtojson');
const redis = require('redis');
const {Storage} = require('@google-cloud/storage');
const storage = new Storage();
const gcpBucket = process.env.GCPBUCKET || 'locatorflex_bucket';
const gcpStoreFile = process.env.GCPSTOREFILE || 'storeList.csv';
const gcpZipFile = process.env.GCPZIPFILE || 'zipList.csv';
const REDISHOST = process.env.REDISHOST || 'localhost';
const REDISPORT = process.env.REDISPORT || 6379;

/**
* Public function for reading the Store location file from Google Cloud Storage
* and loading into Google CloudMemory(redis).  
* Will propagate exceptions.
*/
function loadStoreCache() {
	console.log(`loadStoreCache() executing`);
	const bucket = storage.bucket(gcpBucket);
	const stream = bucket.file(gcpStoreFile).createReadStream();
	const client = redis.createClient(REDISPORT, REDISHOST);
	client.on("error", function (err) {
		console.log("loadStoreCache() Redis error:" + err);
	});

	csv()
	.fromStream(stream)
	.subscribe((json) => {
		let hashKey;
		for (let [key, value] of Object.entries(json)) {
			if (key === 'storeNum') {
				hashKey = 'store:' + value;
			}
			else {
				console.log(`loadStoreCache() inserting ${hashKey}`);
				client.hset(hashKey, key, value, (err, reply) => {
					if (err) {
						console.error(`loadStoreCache() Error: ${err}`);
					}
					
				});
			}
		}
	})
	.on('done', (err) => {
		client.quit();
		console.log(`loadStoreCache() complete`);
	});
};

/**
* Public function for reading the Zip location file from Google Cloud Storage
* and loading into Google CloudMemory(redis).  
* Will propagate exceptions.
*/
function loadZipCache() {
	console.log(`loadZipCache() executing`);
	const bucket = storage.bucket(gcpBucket);
	const stream = bucket.file(gcpZipFile).createReadStream();
	const client = redis.createClient(REDISPORT, REDISHOST);	
	client.on("error", function (err) {
		console.log("loadZipCache() Redis error:" + err);
	});

	csv()
	.fromStream(stream)
	.subscribe((json) => {
		let hashKey;
		for (let [key, value] of Object.entries(json)) {
			if (key === 'zip') {
					hashKey = 'zip:' + value;
			}
			else {
				console.log(`loadZipCache() inserting ${hashKey}`);
				client.hset(hashKey, key, value, (err, reply) => {
					if (err) {
						console.error(`loadZipCache() Error: ${err}`);
					}
					
				});
			}
		}
	})
	.on('done', (err) => {
			client.quit();
			console.log(`loadZipCache() complete`);
	});
}

/**
 * Triggered from a change to a Cloud Storage bucket.
 *
 * @param {!Object} file Event payload.
 * @param {!Object} context Metadata for the event.
 */
exports.gcsMonitor = (file, context) => {
	console.log(`gcsMonitor() executing, file: ${file.name}`);
	
	switch (file.name) {
		case gcpStoreFile:
			loadStoreCache();
			break;
		case gcpZipFile:
			loadZipCache();
			break;
	}
	console.log(`gcsMonitor() complete`);
};
